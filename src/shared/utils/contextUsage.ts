import type { AgentEvent, PersistedEvent } from '../ipc'
import { isAgentEvent } from './eventUtils'
import {
  emptyStepUsageTotals,
  mergeStepUsageTotals,
  stepUsageFromEvent,
  type StepUsageTotals
} from './runTelemetry'

export type ContextLayerBreakdown = {
  system: number
  history: number
  tools: number
  buffer: number
}

export type ContextUsageState = {
  step: number
  used: number
  estimatedTokens: number
  inputTokens?: number
  window: number
  contentWindow: number
  compactionTrigger: number
  source: 'estimate' | 'provider'
  layers: ContextLayerBreakdown
  stepUsage: StepUsageTotals
  updatedAt: string
}

export function contextUsageFromEvent(
  event: AgentEvent,
  stepUsage: StepUsageTotals = emptyStepUsageTotals()
): ContextUsageState | null {
  if (event.type !== 'context_usage') return null
  const used = event.inputTokens ?? event.estimatedTokens
  return {
    step: event.step,
    used,
    estimatedTokens: event.estimatedTokens,
    inputTokens: event.inputTokens,
    window: event.contextWindow,
    contentWindow: event.contentWindow ?? event.contextWindow,
    compactionTrigger: event.compactionTrigger,
    source: event.source,
    layers: event.layers,
    stepUsage,
    updatedAt: new Date().toISOString()
  }
}

export function summarizeContextUsageFromEvents(
  events: PersistedEvent[]
): ContextUsageState | null {
  let stepUsage = emptyStepUsageTotals()
  let latest: ContextUsageState | null = null

  for (const row of events) {
    if (!isAgentEvent(row.event)) continue
    const usage = stepUsageFromEvent(row.event)
    if (usage) stepUsage = mergeStepUsageTotals(stepUsage, usage)
    const ctx = contextUsageFromEvent(row.event, stepUsage)
    if (ctx) {
      latest = { ...ctx, stepUsage, updatedAt: row.at }
    }
  }

  return latest
}
