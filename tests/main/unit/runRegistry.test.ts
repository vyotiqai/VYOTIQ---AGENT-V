import { describe, expect, it } from 'vitest'
import {
  registerRunAbort,
  clearRunAbort,
  resetActiveRunsForTests,
  listActiveRuns,
  isActive,
  markRunTurnComplete,
  enqueueFollowUp,
  drainFollowUps,
  removeFollowUp,
  hasPendingFollowUps,
  peekFollowUps,
  setStreamInterrupt,
  chatCancelResult,
  tryBeginRunClosing,
  cancelRun
} from '@main/agent/runRegistry'

describe('runRegistry listActiveRuns', () => {
  it('keeps the run listed until clearRunAbort (including turn-complete unwind)', () => {
    resetActiveRunsForTests()
    const runId = 'session-run'
    const first = registerRunAbort(runId, '/ws')
    expect(listActiveRuns()).toEqual([
      { runId, workspacePath: '/ws', invokeId: first.invokeId, pendingFollowUps: [] }
    ])
    expect(isActive(runId)).toBe(true)

    markRunTurnComplete(runId, first.invokeId)
    expect(isActive(runId)).toBe(true)
    expect(listActiveRuns()).toEqual([
      { runId, workspacePath: '/ws', invokeId: first.invokeId, pendingFollowUps: [] }
    ])

    // No overlapping invoke while unwinding.
    const again = registerRunAbort(runId, '/ws')
    expect(again.invokeId).toBe(first.invokeId)

    clearRunAbort(runId, first.invokeId)
    expect(isActive(runId)).toBe(false)
    expect(listActiveRuns()).toEqual([])

    const second = registerRunAbort(runId, '/ws')
    expect(second.invokeId).not.toBe(first.invokeId)
    expect(listActiveRuns()).toEqual([
      { runId, workspacePath: '/ws', invokeId: second.invokeId, pendingFollowUps: [] }
    ])

    clearRunAbort(runId, second.invokeId)
    expect(listActiveRuns()).toEqual([])
  })
})

describe('runRegistry follow-ups', () => {
  it('queues, drains, and soft-aborts the stream interrupt', () => {
    resetActiveRunsForTests()
    const runId = 'follow-up-run'
    registerRunAbort(runId, '/ws')
    const streamAbort = new AbortController()
    setStreamInterrupt(runId, streamAbort)

    const queued = enqueueFollowUp(runId, { role: 'user', content: 'steer' })
    expect(queued.ok).toBe(true)
    if (!queued.ok) return
    expect(queued.position).toBe(1)
    expect(hasPendingFollowUps(runId)).toBe(true)
    expect(streamAbort.signal.aborted).toBe(true)

    const second = enqueueFollowUp(runId, { role: 'user', content: 'again' })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const removed = removeFollowUp(runId, second.id)
    expect(removed).toEqual({ ok: true, removed: true, queueLength: 1 })

    const drained = drainFollowUps(runId)
    expect(drained).toHaveLength(1)
    expect(drained[0]?.message).toEqual({ role: 'user', content: 'steer' })
    expect(hasPendingFollowUps(runId)).toBe(false)
  })

  it('rejects follow-ups when the run is inactive and clears on cancel', () => {
    resetActiveRunsForTests()
    expect(enqueueFollowUp('missing', { role: 'user', content: 'x' }).ok).toBe(false)

    const runId = 'cancel-follow-ups'
    registerRunAbort(runId, '/ws')
    enqueueFollowUp(runId, { role: 'user', content: 'queued' })
    expect(chatCancelResult(runId)).toEqual({ ok: true, data: true })
    expect(hasPendingFollowUps(runId)).toBe(false)
  })

  it('rejects enqueue after cancel abort so follow-ups are not ack-then-dropped', () => {
    resetActiveRunsForTests()
    const runId = 'abort-reject-follow-up'
    registerRunAbort(runId, '/ws')
    expect(cancelRun(runId)).toBe(true)
    expect(enqueueFollowUp(runId, { role: 'user', content: 'too late' })).toEqual({
      ok: false,
      error: 'Run is not active'
    })
  })

  it('tryBeginRunClosing drains atomically when a follow-up races the close', () => {
    resetActiveRunsForTests()
    const runId = 'close-race'
    const handle = registerRunAbort(runId, '/ws')
    expect(tryBeginRunClosing(runId, handle.invokeId)).toBe('closed')

    resetActiveRunsForTests()
    const handle2 = registerRunAbort(runId, '/ws')
    enqueueFollowUp(runId, { role: 'user', content: 'steer' })
    expect(tryBeginRunClosing(runId, handle2.invokeId)).toBe('has_followups')
    expect(drainFollowUps(runId)).toHaveLength(1)
    expect(tryBeginRunClosing(runId, handle2.invokeId)).toBe('closed')
  })

  it('preserves follow-ups across markRunTurnComplete and exposes them on listActiveRuns', () => {
    resetActiveRunsForTests()
    const runId = 'preserve-follow-ups'
    const handle = registerRunAbort(runId, '/ws')
    const queued = enqueueFollowUp(runId, { role: 'user', content: 'late steer' })
    expect(queued.ok).toBe(true)
    if (!queued.ok) return

    expect(listActiveRuns()[0]?.pendingFollowUps).toEqual([
      { id: queued.id, preview: 'late steer' }
    ])

    markRunTurnComplete(runId, handle.invokeId)
    // Queue is not wiped by turn-complete (loop drains or cancel clears).
    expect(peekFollowUps(runId)).toHaveLength(1)
    expect(listActiveRuns()).toEqual([
      {
        runId,
        workspacePath: '/ws',
        invokeId: handle.invokeId,
        pendingFollowUps: [{ id: queued.id, preview: 'late steer' }]
      }
    ])
  })
})
