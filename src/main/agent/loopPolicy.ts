/** After this many consecutive all-failure tool steps, run read-only tools one at a time. */
export const CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD = 2

/** After this many consecutive all-failure tool steps, inject a run notice into system context. */
export const CONSECUTIVE_TOOL_FAILURE_HINT_THRESHOLD = 3

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
    'Prefer built-in tools, or disable unused MCP servers in Settings → Marketplace so the rest fit.'
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
