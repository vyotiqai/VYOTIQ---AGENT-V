import { describe, expect, it } from 'vitest'
import {
  contextUsageFromEvent,
  summarizeContextUsageFromEvents
} from '@shared/utils/contextUsage'

describe('contextUsage', () => {
  it('maps context_usage events into UI state', () => {
    const state = contextUsageFromEvent({
      type: 'context_usage',
      runId: 'r1',
      step: 2,
      estimatedTokens: 1200,
      inputTokens: 1100,
      contextWindow: 128000,
      contentWindow: 89600,
      compactionTrigger: 62720,
      source: 'provider',
      layers: { system: 100, history: 900, tools: 200, buffer: 19200 }
    })
    expect(state).toMatchObject({
      step: 2,
      used: 1100,
      estimatedTokens: 1200,
      window: 128000,
      contentWindow: 89600,
      source: 'provider'
    })
  })

  it('replays the latest context_usage from persisted events', () => {
    const state = summarizeContextUsageFromEvents([
      {
        at: '2026-01-01T00:00:00.000Z',
        event: {
          type: 'context_usage',
          runId: 'r1',
          step: 1,
          estimatedTokens: 800,
          contextWindow: 32000,
          compactionTrigger: 20000,
          source: 'estimate',
          layers: { system: 50, history: 600, tools: 150, buffer: 4800 }
        }
      },
      {
        at: '2026-01-01T00:00:10.000Z',
        event: {
          type: 'step_usage',
          runId: 'r1',
          step: 1,
          inputTokens: 900,
          outputTokens: 40,
          cachedInputTokens: 300
        }
      },
      {
        at: '2026-01-01T00:00:20.000Z',
        event: {
          type: 'context_usage',
          runId: 'r1',
          step: 1,
          estimatedTokens: 800,
          inputTokens: 900,
          contextWindow: 32000,
          contentWindow: 22400,
          compactionTrigger: 15680,
          source: 'provider',
          layers: { system: 50, history: 600, tools: 150, buffer: 4800 }
        }
      }
    ])
    expect(state?.used).toBe(900)
    expect(state?.updatedAt).toBe('2026-01-01T00:00:20.000Z')
    expect(state?.stepUsage.outputTokens).toBe(40)
    expect(state?.stepUsage.cachedInputTokens).toBe(300)
  })
})
