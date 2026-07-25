import { getMcpReadOnlyHint, MCP_TOOL_PREFIX } from '../mcp'

/** Workspace-local reads safe to run concurrently (no file mutation). */
const PARALLEL_SAFE_BUILTIN = new Set([
  'read',
  'search',
  'glob',
  'grep',
  'list_dir',
  'web_fetch',
  'memory_list',
  'memory_read'
])

/**
 * Tools that skip approval in `mutating` mode.
 * Same as parallel-safe except `web_fetch` (network egress still needs a gate).
 */
const APPROVAL_EXEMPT_BUILTIN = new Set(
  [...PARALLEL_SAFE_BUILTIN].filter((name) => name !== 'web_fetch')
)

function isMcpReadOnly(name: string): boolean {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return false
  return getMcpReadOnlyHint(name) === true
}

/** Built-in / MCP tools safe to run in parallel (no workspace mutation). */
export function isParallelSafeTool(name: string): boolean {
  if (PARALLEL_SAFE_BUILTIN.has(name)) return true
  return isMcpReadOnly(name)
}

/**
 * Tools that do not require approval when mode is `mutating`.
 * `web_fetch` is parallel-safe but not approval-exempt (outbound network).
 */
export function isApprovalExemptTool(name: string): boolean {
  if (APPROVAL_EXEMPT_BUILTIN.has(name)) return true
  return isMcpReadOnly(name)
}

/** @deprecated Prefer `isParallelSafeTool` — kept for call-site clarity in older tests. */
export function isReadOnlyTool(name: string): boolean {
  return isParallelSafeTool(name)
}

export const MAX_PARALLEL_READ_TOOLS = 4
