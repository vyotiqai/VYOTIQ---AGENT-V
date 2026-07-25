import type { AgentEvent } from '../ipc'

export const MCP_TOOL_PREFIX = 'mcp__'

export const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  read: { running: 'Reading', done: 'Read' },
  edit: { running: 'Editing', done: 'Edited' },
  write: { running: 'Writing', done: 'Wrote' },
  search: { running: 'Searching', done: 'Searched' },
  terminal: { running: 'Running', done: 'Ran' },
  memory_list: { running: 'Listing memory', done: 'Listed memory' },
  memory_read: { running: 'Reading memory', done: 'Read memory' },
  memory_write: { running: 'Writing memory', done: 'Wrote memory' }
}

export function parseMcpToolDisplay(
  name: string
): { serverId: string; toolName: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null
  const rest = name.slice(MCP_TOOL_PREFIX.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return null
  return { serverId: rest.slice(0, sep), toolName: rest.slice(sep + 2) }
}

function truncate(text: string, max = 120): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

function parseArgsRecord(args: string | undefined): Record<string, unknown> | null {
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

export function normalizeToolTarget(name: string, args: Record<string, unknown> | null): string {
  if (!args) return ''
  if (name === 'read' || name === 'edit' || name === 'write') {
    const path = args.path ?? args.file
    if (typeof path === 'string') return path
  }
  if (name === 'search') {
    const query = args.query ?? args.pattern
    if (typeof query === 'string') return query
  }
  if (name === 'terminal') {
    const command = args.command ?? args.cmd
    if (typeof command === 'string') return command
  }
  if (name === 'memory_read' || name === 'memory_write' || name === 'memory_list') {
    const path = args.path ?? args.note
    if (typeof path === 'string') return path
  }
  const query = args.query
  if (typeof query === 'string') return query
  return ''
}

export function summarizeToolArgsFromRecord(
  name: string,
  args: Record<string, unknown>
): string {
  const target = normalizeToolTarget(name, args)
  if (target) return truncate(target)
  const keys = Object.keys(args)
  if (keys.length === 0) return ''
  try {
    return truncate(JSON.stringify(args))
  } catch {
    return ''
  }
}

export function summarizeToolArgs(name: string, args: string | undefined): string {
  const parsed = parseArgsRecord(args)
  if (parsed) {
    const fromRecord = summarizeToolArgsFromRecord(name, parsed)
    if (fromRecord) return fromRecord
  }
  if (args?.trim()) return truncate(args.replace(/\s+/g, ' '))
  return ''
}

export function mcpToolSummary(toolName: string, args: Record<string, unknown>): string {
  const target = normalizeToolTarget(`mcp__x__${toolName}`, args)
  if (target) return truncate(target)
  return toolName
}

export function formatToolRowLabel(
  name: string,
  status: 'running' | 'done' | 'fail',
  summary?: string,
  argsPreview?: string
): string {
  const mcp = parseMcpToolDisplay(name)
  const detail = summary?.trim() || summarizeToolArgs(name, argsPreview)
  if (mcp) {
    if (status === 'running') return detail ? `Calling ${detail}` : `Calling ${mcp.toolName}`
    return detail || mcp.toolName
  }
  const labels = TOOL_LABELS[name]
  const verb = labels
    ? status === 'running'
      ? labels.running
      : labels.done
    : status === 'running'
      ? 'Running tool'
      : 'Tool'
  if (!detail) return verb
  if (name === 'terminal') return `${verb} ${detail}`.trim()
  return `${verb} ${detail}`.trim()
}

export function formatActivityEventLabel(event: AgentEvent): string {
  switch (event.type) {
    case 'status':
      if (event.status === 'running') return 'Run started'
      if (event.status === 'done') return 'Run finished'
      if (event.status === 'cancelled') return 'Run cancelled'
      return 'Run error'
    case 'tool_start':
      return `Tool ${event.name}`
    case 'tool_result':
      return event.ok ? `Tool ${event.name} done` : `Tool ${event.name} failed`
    case 'thinking_delta':
      return 'Thinking'
    case 'thinking_done':
      return 'Thinking done'
    case 'text_delta':
      return 'Streaming text'
    case 'assistant_message':
      return 'Assistant message'
    case 'error':
      return event.message || 'Error'
    case 'compaction':
      return 'Context compacted'
    case 'step_budget':
      return 'Step budget warning'
    case 'step_usage':
      return 'Usage update'
    case 'context_usage':
      return 'Context usage'
    case 'tool_call_delta':
      return 'Tool call delta'
    default:
      return 'event'
  }
}
