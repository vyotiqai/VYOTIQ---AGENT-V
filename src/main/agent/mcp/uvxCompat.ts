/**
 * Official Python MCP reference servers (fetch, time) still import `McpError`,
 * which was renamed in the MCP Python SDK v2. Bare `uvx mcp-server-*` pulls
 * mcp>=2 and crashes on startup. Pin the SDK to v1 until those packages update.
 */
const UVX_PACKAGES_NEEDING_MCP_V1 = new Set(['mcp-server-fetch', 'mcp-server-time'])

/** True when args already include a uv `--with` constraint that mentions mcp. */
export function hasUvxMcpWithConstraint(args: string[]): boolean {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--with' && /mcp/i.test(args[i + 1] ?? '')) return true
  }
  return false
}

/**
 * Return stdio args suitable for launching via `uvx`, injecting `--with mcp<2`
 * for known-broken official packages when the caller did not already pin mcp.
 */
export function withCompatibleUvxArgs(
  command: string | undefined,
  args: string[] | undefined
): string[] {
  const next = [...(args ?? [])]
  if ((command ?? '').trim().toLowerCase() !== 'uvx') return next
  if (hasUvxMcpWithConstraint(next)) return next
  const needsPin = next.some((a) => UVX_PACKAGES_NEEDING_MCP_V1.has(a))
  if (!needsPin) return next
  return ['--with', 'mcp<2', ...next]
}
