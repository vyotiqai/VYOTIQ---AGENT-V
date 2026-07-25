export const MCP_TOOL_PREFIX = 'mcp__'

export const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  read: { running: 'Reading', done: 'Read' },
  edit: { running: 'Editing', done: 'Edited' },
  search: { running: 'Searching', done: 'Searched' },
  glob: { running: 'Globbing', done: 'Globbed' },
  grep: { running: 'Grepping', done: 'Grepped' },
  list_dir: { running: 'Listing', done: 'Listed' },
  multi_edit: { running: 'Editing', done: 'Edited' },
  delete: { running: 'Deleting', done: 'Deleted' },
  todo_write: { running: 'Updating tasks', done: 'Updated tasks' },
  web_fetch: { running: 'Fetching', done: 'Fetched' },
  subagent: { running: 'Investigating', done: 'Investigated' },
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

export function normalizeToolTarget(name: string, args: Record<string, unknown> | null): string {
  if (!args) return ''
  if (name === 'read' || name === 'edit' || name === 'delete') {
    const path = args.path ?? args.file
    if (typeof path === 'string') return path
  }
  if (name === 'list_dir') {
    const path = args.path
    return typeof path === 'string' && path.trim() ? path : '.'
  }
  if (name === 'search' || name === 'glob' || name === 'grep') {
    const query = args.query ?? args.pattern
    if (typeof query === 'string') return query
  }
  if (name === 'multi_edit') {
    const edits = args.edits
    if (Array.isArray(edits)) {
      const paths = edits
        .map((edit) =>
          edit && typeof edit === 'object' ? (edit as { path?: unknown }).path : undefined
        )
        .filter((path): path is string => typeof path === 'string')
      if (paths.length) return paths.join(', ')
    }
  }
  if (name === 'todo_write') {
    const todos = args.todos
    if (Array.isArray(todos)) return `${todos.length} tasks`
  }
  if (name === 'web_fetch') {
    const url = args.url
    if (typeof url === 'string') return url
  }
  if (name === 'subagent') {
    const task = args.task
    if (typeof task === 'string') return task
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

