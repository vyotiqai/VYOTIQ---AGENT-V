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

export function maxParallelReadToolsForFailureStreak(
  streak: number,
  defaultMax: number
): number {
  if (streak >= CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD) return 1
  return defaultMax
}
