import type { AgentEvent, PersistedEvent } from '../ipc'
import { isAgentEvent } from './eventUtils'

export type StepUsageTotals = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  steps: number
}

export function emptyStepUsageTotals(): StepUsageTotals {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, steps: 0 }
}

export function mergeStepUsageTotals(a: StepUsageTotals, b: StepUsageTotals): StepUsageTotals {
  return {
    // Each step's inputTokens already includes full context — keep the latest reading.
    inputTokens: b.inputTokens > 0 ? b.inputTokens : a.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    steps: a.steps + b.steps
  }
}

export function stepUsageFromEvent(event: AgentEvent): StepUsageTotals | null {
  if (event.type !== 'step_usage') return null
  return {
    inputTokens: event.inputTokens ?? 0,
    outputTokens: event.outputTokens ?? 0,
    cachedInputTokens: event.cachedInputTokens ?? 0,
    steps: 1
  }
}

export function formatCacheHintFromTotals(totals: StepUsageTotals): string | null {
  if (totals.cachedInputTokens <= 0 || totals.inputTokens <= 0) return null
  const pct = Math.round((totals.cachedInputTokens / totals.inputTokens) * 100)
  return `Prompt cache ${pct}% hit (${totals.cachedInputTokens.toLocaleString()} / ${totals.inputTokens.toLocaleString()} input tokens)`
}

export function summarizeStepUsageFromEvents(events: PersistedEvent[]): string | null {
  let totals = emptyStepUsageTotals()
  for (const row of events) {
    if (!isAgentEvent(row.event)) continue
    const usage = stepUsageFromEvent(row.event)
    if (usage) totals = mergeStepUsageTotals(totals, usage)
  }
  return formatCacheHintFromTotals(totals)
}
