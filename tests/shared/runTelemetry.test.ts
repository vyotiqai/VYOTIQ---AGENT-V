import { describe, expect, it } from 'vitest'
import {
  emptyStepUsageTotals,
  formatCacheHintFromTotals,
  mergeStepUsageTotals,
  stepUsageFromEvent,
  summarizeStepUsageFromEvents
} from '@shared/utils/runTelemetry'

describe('runTelemetry', () => {
  it('formats cache hit ratio from totals', () => {
    const hint = formatCacheHintFromTotals({
      inputTokens: 1000,
      outputTokens: 0,
      cachedInputTokens: 750,
      steps: 2
    })
    expect(hint).toMatch(/75% hit/)
    expect(hint).toMatch(/750/)
  })

  it('returns null when no cached tokens', () => {
    expect(
      formatCacheHintFromTotals({
        inputTokens: 1000,
        outputTokens: 0,
        cachedInputTokens: 0,
        steps: 1
      })
    ).toBeNull()
  })

  it('merges step usage events and summarizes persisted rows', () => {
    const first = stepUsageFromEvent({
      type: 'step_usage',
      runId: 'r1',
      step: 1,
      inputTokens: 500,
      outputTokens: 20,
      cachedInputTokens: 400
    })
    const second = stepUsageFromEvent({
      type: 'step_usage',
      runId: 'r1',
      step: 2,
      inputTokens: 300,
      outputTokens: 10,
      cachedInputTokens: 200
    })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    const totals = mergeStepUsageTotals(first!, second!)
    expect(totals).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      cachedInputTokens: 600,
      steps: 2
    })

    const summary = summarizeStepUsageFromEvents([
      {
        at: '2026-01-01T00:00:00.000Z',
        event: {
          type: 'step_usage',
          runId: 'r1',
          step: 1,
          inputTokens: 1000,
          cachedInputTokens: 500
        }
      }
    ])
    expect(summary).toMatch(/50% hit/)
    expect(emptyStepUsageTotals()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      steps: 0
    })
  })
})
