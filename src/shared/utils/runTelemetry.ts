import type { AgentEvent } from '../ipc'

export type StepUsageTotals = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  /** Billed thinking tokens, a subset of the output tokens above. */
  reasoningTokens: number
  steps: number
}

export function emptyStepUsageTotals(): StepUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    steps: 0
  }
}

export function mergeStepUsageTotals(a: StepUsageTotals, b: StepUsageTotals): StepUsageTotals {
  return {
    // Each step's inputTokens already includes full context — keep the latest reading.
    inputTokens: b.inputTokens > 0 ? b.inputTokens : a.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    // Cached tokens are reported per step against that step's input window — do not sum.
    cachedInputTokens: b.inputTokens > 0 ? b.cachedInputTokens : a.cachedInputTokens,
    // Reasoning is part of each step's output, so it accumulates like output does.
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    steps: a.steps + b.steps
  }
}

export function stepUsageFromEvent(event: AgentEvent): StepUsageTotals | null {
  if (event.type !== 'step_usage') return null
  return {
    inputTokens: event.inputTokens ?? 0,
    outputTokens: event.outputTokens ?? 0,
    cachedInputTokens: event.cachedInputTokens ?? 0,
    reasoningTokens: event.reasoningTokens ?? 0,
    steps: 1
  }
}

