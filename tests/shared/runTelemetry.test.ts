import { describe, expect, it } from 'vitest'
import {
  emptyStepUsageTotals,
  mergeStepUsageTotals,
  stepUsageFromEvent
} from '@shared/utils/runTelemetry'

describe('runTelemetry', () => {
  it('returns null for events that carry no step usage', () => {
    expect(stepUsageFromEvent({ type: 'status', runId: 'r1', status: 'running' })).toBeNull()
  })

  it('keeps the latest input window and sums output across steps', () => {
    const first = stepUsageFromEvent({
      type: 'step_usage',
      runId: 'r1',
      step: 1,
      inputTokens: 500,
      outputTokens: 20,
      cachedInputTokens: 400,
      reasoningTokens: 12
    })
    const second = stepUsageFromEvent({
      type: 'step_usage',
      runId: 'r1',
      step: 2,
      inputTokens: 300,
      outputTokens: 10,
      cachedInputTokens: 200,
      reasoningTokens: 4
    })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(mergeStepUsageTotals(first!, second!)).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      cachedInputTokens: 200,
      reasoningTokens: 16,
      steps: 2
    })
  })

  it('carries the previous input window forward when a step reports none', () => {
    const totals = mergeStepUsageTotals(
      { inputTokens: 900, outputTokens: 5, cachedInputTokens: 700, reasoningTokens: 3, steps: 1 },
      { inputTokens: 0, outputTokens: 7, cachedInputTokens: 0, reasoningTokens: 2, steps: 1 }
    )
    expect(totals.inputTokens).toBe(900)
    expect(totals.cachedInputTokens).toBe(700)
    expect(totals.outputTokens).toBe(12)
    expect(totals.reasoningTokens).toBe(5)
  })

  it('defaults reasoning tokens to zero when the provider omits them', () => {
    const usage = stepUsageFromEvent({
      type: 'step_usage',
      runId: 'r1',
      step: 1,
      inputTokens: 100,
      outputTokens: 10
    })
    expect(usage?.reasoningTokens).toBe(0)
  })

  it('starts from an empty total', () => {
    expect(emptyStepUsageTotals()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      steps: 0
    })
  })
})
