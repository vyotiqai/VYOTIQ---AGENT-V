/**
 * Shared context-budget shares. Main `budget.ts` and UI rescale helpers must
 * stay in lockstep so meters match assembly.
 */
export type BudgetLayerShares = {
  system: number
  tools: number
  memoryWorkspace: number
  history: number
  buffer: number
}

export const BUDGET_SHARES: BudgetLayerShares = {
  system: 0.12,
  tools: 0.18,
  memoryWorkspace: 0.15,
  history: 0.4,
  buffer: 0.15
}

export const DEFAULT_CONTEXT_WINDOW = 128_000
export const DEFAULT_COMPACTION_TRIGGER_RATIO = 0.7

export function allocateBudgetShares(window: number): Record<keyof BudgetLayerShares, number> {
  const system = Math.floor(window * BUDGET_SHARES.system)
  const tools = Math.floor(window * BUDGET_SHARES.tools)
  const memoryWorkspace = Math.floor(window * BUDGET_SHARES.memoryWorkspace)
  const history = Math.floor(window * BUDGET_SHARES.history)
  const buffer = Math.floor(window * BUDGET_SHARES.buffer)
  return {
    system,
    tools,
    memoryWorkspace,
    history,
    buffer: buffer + (window - (system + tools + memoryWorkspace + history + buffer))
  }
}

/** Non-buffer budget (85% of raw window). */
export function contentWindowFromRaw(window: number): number {
  const b = allocateBudgetShares(window)
  return b.system + b.tools + b.memoryWorkspace + b.history
}

export function compactionTriggerFromRaw(
  window: number,
  triggerRatio = DEFAULT_COMPACTION_TRIGGER_RATIO
): number {
  return Math.floor(contentWindowFromRaw(window) * triggerRatio)
}
