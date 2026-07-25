import type { ModelInfo } from '../../../shared/ipc'
import {
  BUDGET_SHARES,
  DEFAULT_CONTEXT_WINDOW,
  type BudgetLayers
} from './types'

export function contextWindowFor(model: ModelInfo): number {
  return model.contextWindow && model.contextWindow > 0
    ? model.contextWindow
    : DEFAULT_CONTEXT_WINDOW
}

export function allocateBudget(model: ModelInfo): Record<keyof BudgetLayers, number> {
  const window = contextWindowFor(model)
  return {
    system: Math.floor(window * BUDGET_SHARES.system),
    tools: Math.floor(window * BUDGET_SHARES.tools),
    memoryWorkspace: Math.floor(window * BUDGET_SHARES.memoryWorkspace),
    history: Math.floor(window * BUDGET_SHARES.history),
    buffer: Math.floor(window * BUDGET_SHARES.buffer)
  }
}

export function effectiveWindow(model: ModelInfo): number {
  const b = allocateBudget(model)
  return b.system + b.tools + b.memoryWorkspace + b.history
}

/** Window available for content after reserving the buffer layer. */
export function contentWindow(model: ModelInfo): number {
  const b = allocateBudget(model)
  return effectiveWindow(model) - b.buffer
}

export function compactionTriggerTokens(
  model: ModelInfo,
  triggerRatio = 0.7
): number {
  return Math.floor(contentWindow(model) * triggerRatio)
}
