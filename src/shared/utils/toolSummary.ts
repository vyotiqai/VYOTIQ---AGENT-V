import {
  extractPathFromTerminalCommand,
  formatListDirPathLabel,
  formatPathLabel,
  sanitizeCommandForDisplay,
  sanitizeDisplayPath
} from './displayPath'
import { humanizeSnakeCase } from './mcpToolMeta'

export const MCP_TOOL_PREFIX = 'mcp__'

/** True while the provider has not yet sent a real tool name (OpenAI nameless deltas). */
export function isUnresolvedToolName(name: string | undefined | null): boolean {
  return !name || name === 'tool'
}

export const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  read: { running: 'Reading', done: 'Read' },
  edit: { running: 'Editing', done: 'Edited' },
  search: { running: 'Searching', done: 'Searched' },
  glob: { running: 'Globbing', done: 'Globbed' },
  grep: { running: 'Grepping', done: 'Grepped' },
  list_dir: { running: 'Listing', done: 'Listed' },
  multi_edit: { running: 'Editing', done: 'Edited' },
  str_replace: { running: 'Editing', done: 'Edited' },
  delete: { running: 'Deleting', done: 'Deleted' },
  todo_write: { running: 'Updating tasks', done: 'Updated tasks' },
  web_fetch: { running: 'Fetching', done: 'Fetched' },
  web_search: { running: 'Searching web', done: 'Web search' },
  browser_navigate: { running: 'Browsing', done: 'Browsed' },
  browser_snapshot: { running: 'Snapshotting', done: 'Snapshot' },
  browser_click: { running: 'Clicking', done: 'Clicked' },
  browser_type: { running: 'Typing', done: 'Typed' },
  browser_scroll: { running: 'Scrolling', done: 'Scrolled' },
  browser_fill: { running: 'Filling', done: 'Filled' },
  subagent: { running: 'Investigating', done: 'Investigated' },
  terminal: { running: 'Running', done: 'Ran' },
  memory_list: { running: 'Listing memory', done: 'Listed memory' },
  memory_read: { running: 'Reading memory', done: 'Read memory' },
  memory_write: { running: 'Writing memory', done: 'Wrote memory' },
  git_status: { running: 'Checking git', done: 'Git status' },
  git_diff: { running: 'Diffing', done: 'Git diff' },
  diagnostics: { running: 'Checking', done: 'Diagnostics' }
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

export function parseArgsRecord(args: string | undefined): Record<string, unknown> | null {
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

function firstStringArg(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function formatPathTarget(path: string): string {
  return truncate(formatPathLabel(sanitizeDisplayPath(path)))
}

export function normalizeToolTarget(name: string, args: Record<string, unknown> | null): string {
  if (!args) return ''
  if (name === 'read' || name === 'edit' || name === 'str_replace' || name === 'delete') {
    const path = args.path ?? args.file
    if (typeof path === 'string') return formatPathTarget(path)
  }
  if (name === 'list_dir') {
    const path = args.path
    const raw = typeof path === 'string' && path.trim() ? path : '.'
    return truncate(formatListDirPathLabel(raw))
  }
  if (name === 'search' || name === 'glob' || name === 'grep') {
    const query = args.query ?? args.pattern
    if (typeof query === 'string') return truncate(query)
  }
  if (name === 'multi_edit') {
    const edits = args.edits
    if (Array.isArray(edits)) {
      const paths = edits
        .map((edit) =>
          edit && typeof edit === 'object' ? (edit as { path?: unknown }).path : undefined
        )
        .filter((path): path is string => typeof path === 'string')
      if (paths.length) return truncate(paths.map((p) => formatPathLabel(p)).join(', '))
    }
  }
  if (name === 'todo_write') {
    const todos = args.todos
    if (Array.isArray(todos)) return `${todos.length} tasks`
  }
  if (name === 'web_fetch' || name === 'browser_navigate') {
    const url = args.url
    if (typeof url === 'string') return truncate(url)
  }
  if (name === 'web_search') {
    const query = args.query
    if (typeof query === 'string') return truncate(query)
  }
  if (name === 'browser_click' || name === 'browser_type' || name === 'browser_fill' || name === 'browser_scroll') {
    const selector = args.selector
    if (typeof selector === 'string' && selector.trim()) return truncate(selector)
    if (name === 'browser_type') {
      const text = args.text
      if (typeof text === 'string') return truncate(text)
    }
    if (name === 'browser_fill') {
      const value = args.value
      if (typeof value === 'string') return truncate(value)
    }
    if (name === 'browser_scroll') {
      const dx = typeof args.deltaX === 'number' ? args.deltaX : 0
      const dy = typeof args.deltaY === 'number' ? args.deltaY : 0
      if (dx !== 0 || dy !== 0) return `Δ(${dx},${dy})`
    }
  }
  if (name === 'browser_snapshot') {
    return 'page'
  }
  if (name === 'subagent') {
    const task = args.task
    if (typeof task === 'string') return truncate(task)
  }
  if (name === 'terminal') {
    const command = args.command ?? args.cmd
    if (typeof command === 'string') {
      const path = extractPathFromTerminalCommand(command)
      if (path) return formatPathTarget(path)
      return truncate(sanitizeCommandForDisplay(command))
    }
  }
  if (name === 'memory_read' || name === 'memory_write' || name === 'memory_list') {
    const path = args.path ?? args.note
    if (typeof path === 'string') return truncate(path)
  }

  const mcp = parseMcpToolDisplay(name)
  if (mcp) {
    const pathLike = firstStringArg(args, [
      'path',
      'file_path',
      'filePath',
      'filepath',
      'directory',
      'dir',
      'root',
      'uri',
      'url',
      'target'
    ])
    if (pathLike) return formatPathTarget(pathLike)
    const query = firstStringArg(args, ['query', 'pattern', 'search', 'glob'])
    if (query) return truncate(query)
    const command = firstStringArg(args, ['command', 'cmd'])
    if (command) return truncate(sanitizeCommandForDisplay(command))
  }

  const path = args.path ?? args.directory ?? args.root ?? args.workspace
  if (typeof path === 'string' && path.trim()) return formatPathTarget(path)
  const query = args.query
  if (typeof query === 'string') return truncate(query)
  return ''
}

function genericFallbackLabel(name: string): string {
  const labels = TOOL_LABELS[name]
  if (labels) return labels.done.toLowerCase()
  const mcp = parseMcpToolDisplay(name)
  if (mcp) return mcp.toolName.replace(/_/g, ' ')
  return humanizeSnakeCase(name)
}

export function summarizeToolArgsFromRecord(
  name: string,
  args: Record<string, unknown>
): string {
  const target = normalizeToolTarget(name, args)
  if (target) return target
  if (Object.keys(args).length === 0) return ''
  return truncate(genericFallbackLabel(name))
}

export function summarizeToolArgs(name: string, args: string | undefined): string {
  // Placeholder names must not invent a "Tool" subtitle from streaming JSON args —
  // that produces "Running Tool Tool" and expands a raw args dump in the timeline.
  if (isUnresolvedToolName(name)) return ''
  const parsed = parseArgsRecord(args)
  if (parsed) {
    const fromRecord = summarizeToolArgsFromRecord(name, parsed)
    if (fromRecord) return fromRecord
  }
  if (args?.trim()) {
    const trimmed = args.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return truncate(genericFallbackLabel(name))
    return truncate(trimmed.replace(/\s+/g, ' '))
  }
  return ''
}

export function mcpToolSummary(toolName: string, args: Record<string, unknown>): string {
  const target = normalizeToolTarget(`mcp__x__${toolName}`, args)
  if (target) return target
  return ''
}
