import type { RunSummary } from '@shared/ipc'

export function runTitle(run: RunSummary): string {
  const goal = run.goal?.trim()
  if (goal) return goal.length > 42 ? `${goal.slice(0, 42)}…` : goal
  return run.runId.slice(0, 8)
}

export function runTooltip(run: RunSummary): string {
  return run.goal?.trim() || run.runId
}
