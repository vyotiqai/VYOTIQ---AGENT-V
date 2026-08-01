/**
 * Explicit registry for in-flight subagents (in-process), analogous to
 * terminalSessions dispose-for-invoke ownership. Parent abort links to a
 * per-child AbortController; dispose hard-cancels remaining children.
 *
 * Two signals per registration:
 * - `signal` — aborts on parent abort OR dispose (stops nested work)
 * - `hardSignal` — aborts on dispose only (combine with parent run cancel so
 *   nested tools label Cancelled, not Interrupted, on dispose)
 */

export type SubagentRegistration = {
  id: string
  runId: string
  invokeId: number
  parentToolCallId?: string
  /** Soft+dispose: parent abort or dispose. */
  controller: AbortController
  /** Dispose-only hard cancel (does not fire on parent soft interrupt). */
  hardController: AbortController
  /** Resolves when the subagent unregisters (finally). */
  done: Promise<void>
  resolveDone: () => void
}

const active = new Map<string, SubagentRegistration>()
let seq = 0

function nextId(): string {
  seq += 1
  return `subagent-${seq}-${Date.now().toString(36)}`
}

function abortRegistration(entry: SubagentRegistration, hard: boolean): void {
  if (!entry.controller.signal.aborted) entry.controller.abort()
  if (hard && !entry.hardController.signal.aborted) entry.hardController.abort()
}

export type RegisterSubagentOpts = {
  runId: string
  invokeId: number
  parentSignal: AbortSignal
  parentToolCallId?: string
}

/**
 * Register an in-flight subagent. Returns child signals linked to the parent:
 * parent abort → `signal` abort; dispose → both `signal` and `hardSignal`.
 * Caller must `unregisterSubagent` in finally.
 */
export function registerSubagent(opts: RegisterSubagentOpts): {
  id: string
  signal: AbortSignal
  hardSignal: AbortSignal
} {
  const id = nextId()
  const controller = new AbortController()
  const hardController = new AbortController()
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  const onParentAbort = (): void => {
    // Parent soft/hard abort stops the child, but only dispose marks hardSignal.
    if (!controller.signal.aborted) controller.abort()
  }
  if (opts.parentSignal.aborted) {
    controller.abort()
  } else {
    opts.parentSignal.addEventListener('abort', onParentAbort, { once: true })
  }

  const entry: SubagentRegistration = {
    id,
    runId: opts.runId,
    invokeId: opts.invokeId,
    parentToolCallId: opts.parentToolCallId,
    controller,
    hardController,
    done,
    resolveDone: () => {
      opts.parentSignal.removeEventListener('abort', onParentAbort)
      resolveDone()
    }
  }
  active.set(id, entry)
  return { id, signal: controller.signal, hardSignal: hardController.signal }
}

export function unregisterSubagent(id: string): void {
  const entry = active.get(id)
  if (!entry) return
  active.delete(id)
  entry.resolveDone()
}

export function listActiveSubagentIds(): string[] {
  return [...active.keys()]
}

export function countActiveSubagentsForInvoke(runId: string, invokeId: number): number {
  let n = 0
  for (const entry of active.values()) {
    if (entry.runId === runId && entry.invokeId === invokeId) n++
  }
  return n
}

const DISPOSE_WAIT_MS = 5_000

async function waitForUnregister(entry: SubagentRegistration): Promise<void> {
  await Promise.race([
    entry.done,
    new Promise<void>((resolve) => {
      setTimeout(resolve, DISPOSE_WAIT_MS)
    })
  ])
  // Force-clear if the subagent never unregistered (wedged provider).
  if (active.has(entry.id)) {
    abortRegistration(entry, true)
    active.delete(entry.id)
    entry.resolveDone()
  }
}

/** Abort all subagents for an invoke and wait for unregister (best-effort). */
export async function disposeSubagentsForInvoke(
  runId: string,
  invokeId: number
): Promise<number> {
  const targets: SubagentRegistration[] = []
  for (const entry of active.values()) {
    if (entry.runId === runId && entry.invokeId === invokeId) targets.push(entry)
  }
  for (const entry of targets) {
    abortRegistration(entry, true)
  }
  if (targets.length > 0) {
    await Promise.allSettled(targets.map((t) => waitForUnregister(t)))
  }
  return targets.length
}

/** Abort all subagents for a run (any invoke). */
export async function disposeSubagentsForRun(runId: string): Promise<number> {
  const targets: SubagentRegistration[] = []
  for (const entry of active.values()) {
    if (entry.runId === runId) targets.push(entry)
  }
  for (const entry of targets) {
    abortRegistration(entry, true)
  }
  if (targets.length > 0) {
    await Promise.allSettled(targets.map((t) => waitForUnregister(t)))
  }
  return targets.length
}

/** Test helper. */
export function resetSubagentRegistryForTests(): void {
  for (const entry of active.values()) {
    abortRegistration(entry, true)
    entry.resolveDone()
  }
  active.clear()
  seq = 0
}
