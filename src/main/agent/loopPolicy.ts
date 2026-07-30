/** After this many consecutive all-failure tool steps, run read-only tools one at a time. */
export const CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD = 2

/** After this many consecutive all-failure tool steps, inject a run notice into system context. */
export const CONSECUTIVE_TOOL_FAILURE_HINT_THRESHOLD = 3

const WRITE_TOOLS = new Set(['edit', 'str_replace', 'multi_edit'])
const UNREAD_EDIT_HINT_PATH_CAP = 5

export function loopHintForConsecutiveFailures(streak: number): string | undefined {
  if (streak < CONSECUTIVE_TOOL_FAILURE_HINT_THRESHOLD) return undefined
  return [
    `Last ${streak} agent steps had only tool failures.`,
    'Stop guessing paths: read README and manifest files from the workspace top-level listing, use search or dir, then one narrow retry.',
    'If still blocked, explain to the user instead of firing many parallel reads.'
  ].join(' ')
}

/** Tell the model which MCP tools were dropped from the tools catalog this run. */
export function loopHintForOmittedMcpTools(omittedNames: readonly string[]): string | undefined {
  if (omittedNames.length === 0) return undefined
  const preview = omittedNames.slice(0, 8).join(', ')
  const more = omittedNames.length > 8 ? ` (+${omittedNames.length - 8} more)` : ''
  return [
    `${omittedNames.length} MCP tool(s) were omitted from this run to fit the tools token budget: ${preview}${more}.`,
    'Prefer built-in tools, use mcp_list_tools to see what remains connected, or disable unused MCP servers in Settings → Marketplace so the rest fit.'
  ].join(' ')
}

export function combineLoopHints(...hints: Array<string | undefined>): string | undefined {
  const parts = hints.map((h) => h?.trim()).filter((h): h is string => Boolean(h))
  return parts.length ? parts.join('\n\n') : undefined
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

/** Tools whose successful concrete paths count as inspect for read-before-edit. */
export function isInspectToolName(name: string): boolean {
  return name === 'read' || name === 'grep' || name === 'glob'
}

/**
 * Paths that count as “seen” for read-before-edit: `read`, or concrete
 * `grep` include / `glob` pattern (no wildcards).
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

export function loopHintForUnreadEdits(paths: readonly string[]): string | undefined {
  if (paths.length === 0) return undefined
  const unique = [...new Set(paths.map(normalizeWorkspaceRelPath).filter(Boolean))]
  if (unique.length === 0) return undefined
  const shown = unique.slice(0, UNREAD_EDIT_HINT_PATH_CAP)
  const more = unique.length > UNREAD_EDIT_HINT_PATH_CAP ? ` (+${unique.length - UNREAD_EDIT_HINT_PATH_CAP} more)` : ''
  return [
    `Edited path(s) without a prior read in this run: ${shown.join(', ')}${more}.`,
    'Prefer `read` (or grep/glob) before editing existing files. This notice does not block tools.'
  ].join(' ')
}

/** Error content when `readBeforeEdit: require` blocks a write tool. */
export function readBeforeEditBlockMessage(paths: readonly string[]): string {
  const unique = [...new Set(paths.map(normalizeWorkspaceRelPath).filter(Boolean))]
  const shown = unique.slice(0, UNREAD_EDIT_HINT_PATH_CAP)
  const more = unique.length > UNREAD_EDIT_HINT_PATH_CAP ? ` (+${unique.length - UNREAD_EDIT_HINT_PATH_CAP} more)` : ''
  return [
    `Read-before-edit is set to require. Blocked edit of unread existing path(s): ${shown.join(', ')}${more}.`,
    'Call `read` (or concrete grep/glob) on the path first, then retry the edit.'
  ].join(' ')
}

export type ToolCallLike = { id: string; name: string; arguments: string }

/**
 * Partition tool calls for `readBeforeEdit: require`.
 * Same-step inspect paths (read/grep/glob) count as seen before writes in the batch.
 */
export function partitionReadBeforeEditCalls(input: {
  known: ReadonlySet<string>
  calls: readonly ToolCallLike[]
  pathExists: (rel: string) => boolean
}): { allowed: ToolCallLike[]; blocked: Array<{ call: ToolCallLike; paths: string[] }> } {
  const knownForGate = new Set(input.known)
  for (const call of input.calls) {
    const args = parseToolArgs(call.arguments)
    for (const path of inspectPathsFromToolCall(call.name, args)) {
      knownForGate.add(path)
    }
  }
  const allowed: ToolCallLike[] = []
  const blocked: Array<{ call: ToolCallLike; paths: string[] }> = []
  for (const call of input.calls) {
    const args = parseToolArgs(call.arguments)
    const unread = unreadExistingEditPaths(knownForGate, call.name, args, input.pathExists)
    if (unread.length > 0) {
      blocked.push({ call, paths: unread })
    } else {
      allowed.push(call)
    }
  }
  return { allowed, blocked }
}

type SeedMessage = {
  role: string
  toolCalls?: Array<{ name: string; arguments: string }>
  toolName?: string
  ok?: boolean
  content?: unknown
}

/**
 * Seed known paths from transcript so resume does not false-nag.
 * Historical read/edit tool calls count as seen (args only; no per-call ok required).
 */
export function seedKnownPathsFromMessages(messages: readonly SeedMessage[]): Set<string> {
  const known = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const call of msg.toolCalls) {
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
