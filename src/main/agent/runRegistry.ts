type RunEntry = {
  controller: AbortController
  workspacePath: string
  invokeId: number
  /** True after a terminal event so follow-ups can start before cleanup finishes. */
  turnComplete: boolean
}

export type RunAbortHandle = {
  controller: AbortController
  invokeId: number
}

const active = new Map<string, RunEntry>()
let nextInvokeId = 1

/** Register abort controller before the async loop starts so cancel works immediately. */
export function registerRunAbort(runId: string, workspacePath: string): RunAbortHandle {
  const existing = active.get(runId)
  if (existing && !existing.turnComplete) {
    return { controller: existing.controller, invokeId: existing.invokeId }
  }

  const invokeId = nextInvokeId++
  const controller = new AbortController()
  active.set(runId, { controller, workspacePath, invokeId, turnComplete: false })
  return { controller, invokeId }
}

/** Allow the next chatStart while this invoke is still unwinding. */
export function markRunTurnComplete(runId: string, invokeId: number): void {
  const entry = active.get(runId)
  if (entry && entry.invokeId === invokeId) {
    entry.turnComplete = true
  }
}

export function cancelRun(runId: string): boolean {
  const entry = active.get(runId)
  if (!entry) return false
  entry.controller.abort()
  return true
}

export function getRunAbort(runId: string): AbortController | undefined {
  return active.get(runId)?.controller
}

export function getRunWorkspace(runId: string): string | undefined {
  return active.get(runId)?.workspacePath
}

export function isActive(runId: string): boolean {
  const entry = active.get(runId)
  if (!entry) return false
  return !entry.turnComplete
}

/** True when this invoke still owns the run slot (no newer follow-up registered). */
export function isCurrentInvoke(runId: string, invokeId: number): boolean {
  const entry = active.get(runId)
  return entry?.invokeId === invokeId
}

export function listActiveRuns(): { runId: string; workspacePath: string; invokeId: number }[] {
  return [...active.entries()]
    .filter(([, entry]) => !entry.turnComplete)
    .map(([runId, entry]) => ({
      runId,
      workspacePath: entry.workspacePath,
      invokeId: entry.invokeId
    }))
}

export function clearRunAbort(runId: string, invokeId?: number): void {
  const entry = active.get(runId)
  if (!entry) return
  if (invokeId !== undefined && entry.invokeId !== invokeId) return
  active.delete(runId)
}

/** Test helper — clear active controllers between tests. */
export function resetActiveRunsForTests(): void {
  for (const entry of active.values()) entry.controller.abort()
  active.clear()
  nextInvokeId = 1
}

/** Pure cancel helper (no Electron) — used by IPC and tests. */
export function chatCancelResult(
  runId: string
): { ok: true; data: true } | { ok: false; error: string } {
  const entry = active.get(runId)
  if (!entry) {
    return { ok: false, error: 'Run not found' }
  }
  entry.controller.abort()
  return { ok: true, data: true }
}
