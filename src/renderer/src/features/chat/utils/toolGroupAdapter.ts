import type { UiGroupTiming, UiToolRow } from '@shared/transcript'
import { mcpDoneLabel, mcpRunningLabel } from '@shared/utils/mcpToolMeta'
import {
  mcpToolSummary,
  parseArgsRecord,
  parseMcpToolDisplay,
  summarizeToolArgs
} from '@shared/toolSummary'
import { formatElapsed } from '@shared/utils/timeFormat'
import {
  categoryLabels,
  mixedGroupLabels,
  toolCategory,
  toolLabel,
  type ToolCategory
} from '../toolUi'
import { parseReadLineRange } from '../toolUi/parsers/read'

export type ToolGroupCategory = ToolCategory

export type ToolGroupNestedTool = {
  id: string
  name: string
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
  runningLabel: string
  doneLabel: string
  elapsedMs: number | null
  elapsedDisplay: string
  singleTool: boolean
}

const INTERRUPTED_CONTENT = new Set(['Cancelled', 'Interrupted', 'Stopped'])

const CATEGORY_COUNT_LABELS: Record<ToolGroupCategory, [singular: string, plural: string]> = {
  file: ['file', 'files'],
  edit: ['edit', 'edits'],
  search: ['lookup', 'lookups'],
  command: ['command', 'commands'],
  browse: ['directory', 'directories']
}

const CATEGORY_MIXED_VERBS: Record<ToolGroupCategory, { running: string; done: string }> = {
  file: { running: 'reading', done: 'read' },
  edit: { running: 'editing', done: 'edited' },
  search: { running: 'searching', done: 'searched' },
  command: { running: 'running commands', done: 'ran commands' },
  browse: { running: 'listing directories', done: 'listed directories' }
}

function capitalize(text: string): string {
  if (!text) return text
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function joinComposite(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return capitalize(parts[0]!)
  if (parts.length === 2) return `${capitalize(parts[0]!)} and ${parts[1]}`
  return `${capitalize(parts[0]!)}, ${parts.slice(1, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function compositeMixedLabels(tools: ToolGroupNestedTool[]): { running: string; done: string } {
  const counts: Record<ToolGroupCategory, number> = {
    file: 0,
    edit: 0,
    search: 0,
    command: 0,
    browse: 0
  }
  for (const tool of tools) counts[tool.category] += 1

  const order: ToolGroupCategory[] = ['file', 'browse', 'search', 'command', 'edit']
  const active = order.filter((category) => counts[category] > 0)
  if (active.length === 0) return mixedGroupLabels()
  if (active.length === 1) return categoryLabels(active[0]!)

  const running = joinComposite(active.map((category) => CATEGORY_MIXED_VERBS[category].running))
  const done = joinComposite(active.map((category) => CATEGORY_MIXED_VERBS[category].done))
  return { running, done }
}

function groupLabels(
  tools: ToolGroupNestedTool[],
  names: string[]
): { running: string; done: string } {
  const first = tools[0]
  if (!first) return mixedGroupLabels()
  if (names.length > 0 && names.every((name) => name === names[0])) {
    const mcp = parseMcpToolDisplay(names[0]!)
    if (mcp) {
      return {
        running: mcpRunningLabel(mcp.toolName),
        done: mcpDoneLabel(mcp.toolName)
      }
    }
    const specific = {
      running: toolLabel(names[0]!, 'running'),
      done: toolLabel(names[0]!, 'done')
    }
    if (specific.running !== 'Running' && specific.done !== 'Done') return specific
  }
  return tools.every((tool) => tool.category === first.category)
    ? categoryLabels(first.category)
    : compositeMixedLabels(tools)
}

function toolSubtitle(tool: UiToolRow): string {
  const summary = tool.summary?.trim() || summarizeToolArgs(tool.name, tool.argsPreview)
  if (!summary) return '…'
  if (tool.name === 'terminal') return summary.slice(0, 80)
  if (tool.name === 'read' || tool.name === 'edit' || tool.name === 'delete') {
    const parts = summary.split(/[/\\]/)
    const file = parts[parts.length - 1] || summary
    const range = tool.name === 'read' ? parseReadLineRange(tool) : ''
    return range ? `${file} ${range}` : file
  }
  const mcp = parseMcpToolDisplay(tool.name)
  if (mcp) {
    const args = parseArgsRecord(tool.argsPreview)
    if (args) {
      const fromMcp = mcpToolSummary(mcp.toolName, args)
      if (fromMcp) return fromMcp.length > 80 ? `${fromMcp.slice(0, 77)}...` : fromMcp
    }
  }
  return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary
}

function nestedRowTitle(tool: UiToolRow, subtitle: string, inGroup: boolean): string {
  if (inGroup && subtitle && subtitle !== '…') return subtitle
  return toolLabel(tool.name, tool.status)
}

function formatCount(value: number, label: string, plural: string): string {
  return `${value} ${value === 1 ? label : plural}`
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
  if (counts.file > 0) {
    const [s, p] = CATEGORY_COUNT_LABELS.file
    parts.push(formatCount(counts.file, s, p))
  }
  if (counts.edit > 0) {
    const [s, p] = CATEGORY_COUNT_LABELS.edit
    parts.push(formatCount(counts.edit, s, p))
  }
  if (counts.search > 0) {
    const [s, p] = CATEGORY_COUNT_LABELS.search
    parts.push(formatCount(counts.search, s, p))
  }
  if (counts.command > 0) {
    const [s, p] = CATEGORY_COUNT_LABELS.command
    parts.push(formatCount(counts.command, s, p))
  }
  if (counts.browse > 0) {
    const [s, p] = CATEGORY_COUNT_LABELS.browse
    parts.push(formatCount(counts.browse, s, p))
  }

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
  const inGroup = tools.length > 1
  const nestedTools: ToolGroupNestedTool[] = tools.map((tool) => {
    const subtitle = toolSubtitle(tool)
    return {
      id: tool.id,
      name: tool.name,
      category: toolCategory(tool.name),
      title: nestedRowTitle(tool, subtitle, inGroup),
      subtitle: inGroup ? '' : subtitle,
      status: tool.status
    }
  })

  const state = deriveState(tools, options.groupTiming)
  const { groupTiming } = options

  let elapsedMs: number | null = null
  if (groupTiming?.startedAt != null) {
    if (groupTiming.endedAt != null) elapsedMs = groupTiming.endedAt - groupTiming.startedAt
    else if (state === 'pending') elapsedMs = Date.now() - groupTiming.startedAt
  }

  const labels = groupLabels(
    nestedTools,
    tools.map((tool) => tool.name)
  )

  const allSubagents = tools.length > 0 && tools.every((tool) => tool.name === 'subagent')
  const summary = allSubagents
    ? `${tools.length} agent${tools.length === 1 ? '' : 's'}`
    : summarizeCounts(nestedTools)

  return {
    state,
    nestedTools,
    summary,
    runningLabel: labels.running,
    doneLabel: labels.done,
    elapsedMs,
    elapsedDisplay: elapsedMs != null && elapsedMs >= 1000 ? formatElapsed(elapsedMs) : '',
    singleTool: tools.length === 1
  }
}
