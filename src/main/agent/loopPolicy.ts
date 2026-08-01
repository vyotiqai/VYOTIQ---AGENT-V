/** After this many consecutive all-failure tool steps, run read-only tools one at a time. */
export const CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD = 2

const WRITE_TOOLS = new Set(['edit', 'str_replace', 'multi_edit'])
const FILE_MUTATION_TOOLS = new Set([...WRITE_TOOLS, 'delete'])

/** Tell the model which MCP tools were dropped from the tools catalog this run. */
export function loopHintForOmittedMcpTools(omittedNames: readonly string[]): string | undefined {
  if (omittedNames.length === 0) return undefined
  const preview = omittedNames.slice(0, 8).join(', ')
  const more = omittedNames.length > 8 ? ` (+${omittedNames.length - 8} more)` : ''
  return [
    `${omittedNames.length} MCP tool(s) were omitted from this run to fit the tools token budget: ${preview}${more}.`,
    'mcp_list_tools shows connected tools (including omitted). Call request_mcp_tools to pin needed tools for the next step, or disable unused MCP servers in Settings → Marketplace.'
  ].join(' ')
}

export function combineLoopHints(...hints: Array<string | undefined>): string | undefined {
  const parts = hints.map((h) => h?.trim()).filter((h): h is string => Boolean(h))
  return parts.length ? parts.join('\n\n') : undefined
}

/** When auto-compaction runs but produces no summary (provider error / empty). */
export function loopHintForCompactionFailure(): string {
  return [
    'Automatic history compaction produced no summary this step; older turns may still be large.',
    'Move durable facts into memory, or ask the user to run /compact.'
  ].join(' ')
}

export function maxParallelReadToolsForFailureStreak(
  streak: number,
  defaultMax: number
): number {
  if (streak >= CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD) return 1
  return defaultMax
}

export function normalizeWorkspaceRelPath(path: string): string {
  return path.trim().replace(/\\/g, '/')
}

function parseToolArgs(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore malformed args
  }
  return {}
}

export function editPathsFromToolCall(
  name: string,
  args: Record<string, unknown>
): string[] {
  if (name === 'edit' || name === 'str_replace') {
    const path = typeof args.path === 'string' ? normalizeWorkspaceRelPath(args.path) : ''
    return path ? [path] : []
  }
  if (name === 'multi_edit' && Array.isArray(args.edits)) {
    const paths: string[] = []
    for (const entry of args.edits) {
      if (entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string') {
        const path = normalizeWorkspaceRelPath((entry as { path: string }).path)
        if (path) paths.push(path)
      }
    }
    return paths
  }
  return []
}

export function readPathFromToolCall(
  name: string,
  args: Record<string, unknown>
): string | null {
  if (name !== 'read') return null
  const path = typeof args.path === 'string' ? normalizeWorkspaceRelPath(args.path) : ''
  return path || null
}

/** True when a path/glob string names a single concrete file (no wildcards). */
export function isConcreteWorkspacePath(value: string): boolean {
  const path = normalizeWorkspaceRelPath(value)
  if (!path || path === '.' || path === '..') return false
  if (/[*?[{]/.test(path)) return false
  return true
}

/** Tools whose successful concrete paths count as inspect for path tracking. */
export function isInspectToolName(name: string): boolean {
  return name === 'read' || name === 'grep' || name === 'glob'
}

/** Tools whose successful results can make earlier diagnostics stale. */
export function isFileMutationToolName(name: string): boolean {
  return FILE_MUTATION_TOOLS.has(name)
}

/**
 * Paths that count as “seen”: `read`, or concrete `grep` include / `glob` pattern
 * (no wildcards).
 */
export function inspectPathsFromToolCall(
  name: string,
  args: Record<string, unknown>
): string[] {
  if (name === 'read') {
    const path = readPathFromToolCall(name, args)
    return path ? [path] : []
  }
  if (name === 'grep') {
    // Schema/executor only accept `include` (not `path`); ignore hallucinated path args.
    const raw = args.include
    if (typeof raw === 'string' && isConcreteWorkspacePath(raw)) {
      return [normalizeWorkspaceRelPath(raw)]
    }
    return []
  }
  if (name === 'glob') {
    const pattern = typeof args.pattern === 'string' ? args.pattern : ''
    if (isConcreteWorkspacePath(pattern)) return [normalizeWorkspaceRelPath(pattern)]
    return []
  }
  return []
}

export function applyToolCallToKnownPaths(
  known: Set<string>,
  name: string,
  args: Record<string, unknown>,
  ok: boolean
): void {
  if (!ok) return
  for (const path of inspectPathsFromToolCall(name, args)) {
    known.add(path)
  }
  for (const path of editPathsFromToolCall(name, args)) {
    known.add(path)
  }
}

export function unreadExistingEditPaths(
  known: ReadonlySet<string>,
  name: string,
  args: Record<string, unknown>,
  pathExists: (rel: string) => boolean
): string[] {
  if (!WRITE_TOOLS.has(name)) return []
  const unread: string[] = []
  for (const path of editPathsFromToolCall(name, args)) {
    if (known.has(path)) continue
    if (!pathExists(path)) continue
    unread.push(path)
  }
  return unread
}

type SeedMessage = {
  role: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  toolCallId?: string
  toolName?: string
  ok?: boolean
  content?: unknown
}

/**
 * Seed known paths from transcript (used by receipts for unread-edit observation).
 * Only calls with a matching successful tool result count as seen.
 */
export function seedKnownPathsFromMessages(messages: readonly SeedMessage[]): Set<string> {
  const known = new Set<string>()
  const successfulCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolCallId && msg.ok !== false) {
      successfulCallIds.add(msg.toolCallId)
    }
  }
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const call of msg.toolCalls) {
        if (!successfulCallIds.has(call.id)) continue
        const args = parseToolArgs(call.arguments)
        applyToolCallToKnownPaths(known, call.name, args, true)
      }
    }
  }
  return known
}

/** Parse tool-call argument JSON for loop wiring. */
export function toolArgsFromCall(argumentsJson: string): Record<string, unknown> {
  return parseToolArgs(argumentsJson)
}
