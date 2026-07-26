import type { UiGroupTiming, UiToolRow } from '@shared/transcript'
import {
  parseMcpToolDisplay,
  TOOL_LABELS,
  summarizeToolArgs
} from '@shared/toolSummary'
import { formatElapsed } from '@shared/utils/timeFormat'

export type ToolGroupCategory = 'file' | 'edit' | 'search' | 'command' | 'browse'

export type ToolGroupNestedTool = {
  id: string
  category: ToolGroupCategory
  title: string
  subtitle: string
  status: UiToolRow['status']
}

export type ToolGroupState = 'pending' | 'completed' | 'interrupted'

export type ToolGroupProps = {
  state: ToolGroupState
  nestedTools: ToolGroupNestedTool[]
  summary: string
  /** Header verb derived from what the group actually did. */
  runningLabel: string
  doneLabel: string
  elapsedMs: number | null
  elapsedDisplay: string
}

const FILE_TOOLS = new Set(['read', 'memory_list', 'memory_read'])
const EDIT_TOOLS = new Set(['edit', 'write', 'memory_write'])
const SEARCH_TOOLS = new Set(['search', 'grep', 'glob', 'web_fetch'])
const BROWSE_TOOLS = new Set(['list_dir'])
const COMMAND_TOOLS = new Set(['terminal'])

const INTERRUPTED_CONTENT = new Set(['Cancelled', 'Interrupted', 'Stopped'])

const CATEGORY_LABELS: Record<ToolGroupCategory, { running: string; done: string }> = {
  file: { running: 'Reading', done: 'Read' },
  edit: { running: 'Editing', done: 'Edited' },
  search: { running: 'Searching', done: 'Searched' },
  command: { running: 'Running', done: 'Ran' },
  browse: { running: 'Browsing', done: 'Browsed' }
}

const MIXED_LABELS = { running: 'Exploring', done: 'Explored' }

function toolCategory(name: string): ToolGroupCategory {
  if (FILE_TOOLS.has(name)) return 'file'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (SEARCH_TOOLS.has(name)) return 'search'
  if (BROWSE_TOOLS.has(name)) return 'browse'
  if (COMMAND_TOOLS.has(name)) return 'command'
  if (parseMcpToolDisplay(name)) return 'search'
  return 'file'
}

/** A group of one kind of work names that work; a mixed group is exploration. */
function groupLabels(
  tools: ToolGroupNestedTool[],
  names: string[]
): { running: string; done: string } {
  const first = tools[0]
  if (!first) return MIXED_LABELS
  if (names.length > 0 && names.every((name) => name === names[0])) {
    const specific = TOOL_LABELS[names[0]!]
    if (specific) return specific
  }
  return tools.every((tool) => tool.category === first.category)
    ? CATEGORY_LABELS[first.category]
    : MIXED_LABELS
}

function toolTitle(name: string, status: UiToolRow['status']): string {
  const mcp = parseMcpToolDisplay(name)
  if (mcp) {
    return status === 'running' ? `Calling ${mcp.toolName}` : mcp.toolName
  }
  const labels = TOOL_LABELS[name]
  if (!labels) return name
  return status === 'running' ? labels.running : labels.done
}

function toolSubtitle(tool: UiToolRow): string {
  const summary = tool.summary?.trim() || summarizeToolArgs(tool.name, tool.argsPreview)
  if (!summary) return ''
  if (tool.name === 'terminal') return summary.slice(0, 80)
  if (tool.name === 'read' || tool.name === 'edit' || tool.name === 'write') {
    const parts = summary.split(/[/\\]/)
    const file = parts[parts.length - 1] || summary
    const range = tool.name === 'read' ? readLineRange(tool) : ''
    return range ? `${file} ${range}` : file
  }
  return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary
}

/**
 * The span of the file a read actually returned, as "L12-48".
 *
 * A ranged read states its bounds in the arguments. An unranged one returned the
 * whole file, so its length is the range — but only when the full text is in
 * hand; a preview truncated for IPC would give a number that is simply wrong.
 */
function readLineRange(tool: UiToolRow): string {
  const args = parseArgs(tool.argsPreview)
  const start = typeof args?.startLine === 'number' ? args.startLine : null
  const end = typeof args?.endLine === 'number' ? args.endLine : null
  if (start != null || end != null) {
    return end == null ? `L${start}+` : `L${start ?? 1}-${end}`
  }

  if (tool.contentTruncated || !tool.content) return ''
  const lines = tool.content.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.length > 0 ? `L1-${lines.length}` : ''
}

function parseArgs(args: string | undefined): Record<string, unknown> | null {
  if (!args?.trim()) return null
  try {
    const parsed = JSON.parse(args) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function formatCount(value: number, label: string): string {
  return `${value} ${value === 1 ? label : `${label}s`}`
}

function summarizeCounts(tools: ToolGroupNestedTool[]): string {
  const counts: Record<ToolGroupCategory, number> = {
    file: 0,
    edit: 0,
    search: 0,
    command: 0,
    browse: 0
  }
  for (const tool of tools) counts[tool.category] += 1

  const parts: string[] = []
  if (counts.file > 0) parts.push(formatCount(counts.file, 'file'))
  if (counts.edit > 0) parts.push(formatCount(counts.edit, 'edit'))
  if (counts.search > 0) {
    parts.push(`${counts.search} ${counts.search === 1 ? 'search' : 'searches'}`)
  }
  if (counts.command > 0) parts.push(formatCount(counts.command, 'command'))
  if (counts.browse > 0) parts.push(formatCount(counts.browse, 'browse'))

  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function isInterrupted(tools: UiToolRow[]): boolean {
  return tools.some((tool) => INTERRUPTED_CONTENT.has(tool.content ?? ''))
}

function deriveState(tools: UiToolRow[], groupTiming: UiGroupTiming | undefined): ToolGroupState {
  const hasRunning = tools.some((tool) => tool.status === 'running')
  if (hasRunning && groupTiming?.endedAt == null) return 'pending'
  if (isInterrupted(tools)) return 'interrupted'
  return 'completed'
}

export function mapToolGroupProps(
  tools: UiToolRow[],
  options: {
    groupTiming?: UiGroupTiming
  }
): ToolGroupProps {
  const nestedTools: ToolGroupNestedTool[] = tools.map((tool) => ({
    id: tool.id,
    category: toolCategory(tool.name),
    title: toolTitle(tool.name, tool.status),
    subtitle: toolSubtitle(tool),
    status: tool.status
  }))

  const state = deriveState(tools, options.groupTiming)
  const { groupTiming } = options

  // A finished group with timing that was never closed must not keep ticking up
  // on every re-render — report nothing rather than an invented duration.
  let elapsedMs: number | null = null
  if (groupTiming?.startedAt != null) {
    if (groupTiming.endedAt != null) elapsedMs = groupTiming.endedAt - groupTiming.startedAt
    else if (state === 'pending') elapsedMs = Date.now() - groupTiming.startedAt
  }

  const labels = groupLabels(
    nestedTools,
    tools.map((tool) => tool.name)
  )

  return {
    state,
    nestedTools,
    summary: summarizeCounts(nestedTools),
    runningLabel: labels.running,
    doneLabel: labels.done,
    elapsedMs,
    elapsedDisplay: elapsedMs != null && elapsedMs >= 1000 ? formatElapsed(elapsedMs) : ''
  }
}
