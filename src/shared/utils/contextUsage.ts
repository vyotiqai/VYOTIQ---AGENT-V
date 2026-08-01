import type { AgentEvent, PersistedEvent } from '../ipc'
import { isAgentEvent } from './eventUtils'
import {
  allocateBudgetShares,
  compactionTriggerFromRaw,
  contentWindowFromRaw,
  DEFAULT_COMPACTION_TRIGGER_RATIO
} from '../domain/contextBudget'
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
  /** True when context still exceeds the model window after compaction. */
  overflow?: boolean
}

const EMPTY_LAYERS: ContextLayerBreakdown = {
  system: 0,
  history: 0,
  tools: 0,
  buffer: 0
}

export function contextUsageFromEvent(
  event: AgentEvent,
  stepUsage: StepUsageTotals = emptyStepUsageTotals(),
  /** Prior estimate-layer split for estimate events that omit layers. */
  previousLayers?: ContextLayerBreakdown | null
): ContextUsageState | null {
  if (event.type !== 'context_usage') return null
  const used = event.inputTokens ?? event.estimatedTokens
  // Provider totals are not layer-aligned — never reuse estimate splits with them.
  const layers =
    event.layers ??
    (event.source === 'estimate' ? (previousLayers ?? EMPTY_LAYERS) : EMPTY_LAYERS)
  return {
    step: event.step,
    used,
    estimatedTokens: event.estimatedTokens,
    inputTokens: event.inputTokens,
    window: event.contextWindow,
    contentWindow: event.contentWindow ?? event.contextWindow,
    compactionTrigger: event.compactionTrigger,
    source: event.source,
    layers,
    stepUsage,
    updatedAt: new Date().toISOString(),
    ...(event.overflow ? { overflow: true } : {})
  }
}

export type SubagentContextUsageState = {
  step: number
  used: number
  window: number
  contentWindow: number
  model: string
  updatedAt: string
}

export function subagentContextUsageFromEvent(event: AgentEvent): SubagentContextUsageState | null {
  if (event.type !== 'subagent_context_usage') return null
  return {
    step: event.step,
    used: event.estimatedTokens,
    window: event.contextWindow,
    contentWindow: event.contentWindow ?? event.contextWindow,
    model: event.model,
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
    const ctx = contextUsageFromEvent(row.event, stepUsage, latest?.layers)
    if (ctx) {
      latest = { ...ctx, stepUsage, updatedAt: row.at }
    }
  }

  return latest
}

/**
 * Re-align window / content budget / buffer / compaction trigger to the real
 * model window while keeping measured usage layers. Fixes meters that hydrated
 * from older runs that stored the 128k fallback.
 */
export function alignContextUsageToModelWindow(
  usage: ContextUsageState,
  modelWindow: number,
  triggerRatio = DEFAULT_COMPACTION_TRIGGER_RATIO
): ContextUsageState {
  if (!Number.isFinite(modelWindow) || modelWindow <= 0 || modelWindow === usage.window) {
    return usage
  }
  const shares = allocateBudgetShares(modelWindow)
  const contentWindow = contentWindowFromRaw(modelWindow)
  return {
    ...usage,
    window: modelWindow,
    contentWindow,
    compactionTrigger: compactionTriggerFromRaw(modelWindow, triggerRatio),
    layers: {
      ...usage.layers,
      buffer: shares.buffer
    }
  }
}
