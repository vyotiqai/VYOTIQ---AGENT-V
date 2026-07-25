import type { UiGroupTiming, UiToolRow } from '@shared/transcript'
import {
  parseMcpToolDisplay,
  TOOL_LABELS,
  summarizeToolArgs
} from '@shared/toolSummary'
import { formatElapsed } from '@shared/utils/timeFormat'

export type ToolGroupCategory = 'file' | 'search' | 'command'

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
  elapsedMs: number | null
  elapsedDisplay: string
}

const FILE_TOOLS = new Set(['read', 'edit', 'write', 'memory_list', 'memory_read', 'memory_write'])
const SEARCH_TOOLS = new Set(['search'])
const COMMAND_TOOLS = new Set(['terminal'])

const INTERRUPTED_CONTENT = new Set(['Cancelled', 'Interrupted', 'Stopped'])

function toolCategory(name: string): ToolGroupCategory {
  if (FILE_TOOLS.has(name)) return 'file'
  if (SEARCH_TOOLS.has(name)) return 'search'
  if (COMMAND_TOOLS.has(name)) return 'command'
  if (parseMcpToolDisplay(name)) return 'search'
  return 'file'
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
    return parts[parts.length - 1] || summary
  }
  return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary
}

function formatCount(value: number, label: string): string {
  return `${value} ${value === 1 ? label : `${label}s`}`
}

function summarizeCounts(tools: ToolGroupNestedTool[]): string {
  let fileCount = 0
  let searchCount = 0
  let commandCount = 0

  for (const tool of tools) {
    if (tool.category === 'file') fileCount += 1
    else if (tool.category === 'search') searchCount += 1
    else if (tool.category === 'command') commandCount += 1
  }

  const parts: string[] = []
  if (fileCount > 0) parts.push(formatCount(fileCount, 'file'))
  if (searchCount > 0) {
    parts.push(`${searchCount} ${searchCount === 1 ? 'search' : 'searches'}`)
  }
  if (commandCount > 0) parts.push(formatCount(commandCount, 'command'))

  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function isInterrupted(tools: UiToolRow[]): boolean {
  return tools.some((tool) => INTERRUPTED_CONTENT.has(tool.content ?? ''))
}

function deriveState(
  tools: UiToolRow[],
  groupTiming: UiGroupTiming | undefined,
  running: boolean
): ToolGroupState {
  const hasRunning = tools.some((tool) => tool.status === 'running')
  const isPending = groupTiming?.endedAt == null && (running || hasRunning)

  if (isPending) return 'pending'
  if (isInterrupted(tools)) return 'interrupted'
  return 'completed'
}

export function mapToolGroupProps(
  tools: UiToolRow[],
  options: {
    running: boolean
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

  const state = deriveState(tools, options.groupTiming, options.running)
  const { groupTiming } = options

  let elapsedMs: number | null = null
  if (groupTiming?.startedAt != null) {
    elapsedMs = (groupTiming.endedAt ?? Date.now()) - groupTiming.startedAt
  }

  return {
    state,
    nestedTools,
    summary: summarizeCounts(nestedTools),
    elapsedMs,
    elapsedDisplay: elapsedMs != null && elapsedMs >= 1000 ? formatElapsed(elapsedMs) : ''
  }
}
