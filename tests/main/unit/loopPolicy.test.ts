import { describe, expect, it } from 'vitest'
import {
  CONSECUTIVE_TOOL_FAILURE_HINT_THRESHOLD,
  CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD,
  loopHintForConsecutiveFailures,
  maxParallelReadToolsForFailureStreak
} from '@main/agent/loopPolicy'

describe('loopPolicy', () => {
  it('does not hint before the threshold', () => {
    expect(loopHintForConsecutiveFailures(CONSECUTIVE_TOOL_FAILURE_HINT_THRESHOLD - 1)).toBeUndefined()
  })

  it('hints at and after the threshold', () => {
    const hint = loopHintForConsecutiveFailures(CONSECUTIVE_TOOL_FAILURE_HINT_THRESHOLD)
    expect(hint).toMatch(/tool failures/i)
    expect(hint).toMatch(/README/)
  })

  it('serializes parallel reads after consecutive failure threshold', () => {
    expect(
      maxParallelReadToolsForFailureStreak(CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD - 1, 4)
    ).toBe(4)
    expect(
      maxParallelReadToolsForFailureStreak(CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD, 4)
    ).toBe(1)
  })
})
