/** Workspace-local reads safe to run concurrently (no file mutation). */
const PARALLEL_SAFE_BUILTIN = new Set([
  'read',
  'search',
  'glob',
  'grep',
  'list_dir',
  'web_fetch',
  'web_search',
  'memory_list',
  'memory_read',
  'subagent',
  'git_status',
  'git_diff',
  'diagnostics'
])

/**
 * Tools that skip approval in `mutating` mode.
 * Same as parallel-safe except network egress (`web_fetch`, `web_search`).
 * Browser tools are serial (shared BrowserWindow) and always gated.
 */
const APPROVAL_EXEMPT_BUILTIN = new Set(
  [...PARALLEL_SAFE_BUILTIN].filter((name) => name !== 'web_fetch' && name !== 'web_search')
)

/**
 * Built-in tools safe to run in parallel (no workspace mutation).
 * MCP tools are never parallel-safe — server `readOnlyHint` is untrusted.
 */
export function isParallelSafeTool(name: string): boolean {
  return PARALLEL_SAFE_BUILTIN.has(name)
}

/**
 * Tools that do not require approval when mode is `mutating`.
 * `web_fetch` / `web_search` are parallel-safe but not approval-exempt (outbound network).
 * `browser_*` tools are serial-only and always gated (shared window + egress).
 * MCP tools always require approval in `mutating`/`all` — hint is untrusted.
 */
export function isApprovalExemptTool(name: string): boolean {
  return APPROVAL_EXEMPT_BUILTIN.has(name)
}

/** @deprecated Prefer `isParallelSafeTool` — kept for call-site clarity in older tests. */
export function isReadOnlyTool(name: string): boolean {
  return isParallelSafeTool(name)
}

export const MAX_PARALLEL_READ_TOOLS = 4
/** Full LLM loops — keep concurrency lower than read-only tools. */
export const MAX_PARALLEL_SUBAGENTS = 2
