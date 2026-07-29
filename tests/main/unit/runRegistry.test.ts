import { describe, expect, it } from 'vitest'
import {
  registerRunAbort,
  clearRunAbort,
  resetActiveRunsForTests,
  listActiveRuns,
  isActive,
  markRunTurnComplete
} from '@main/agent/runRegistry'

describe('runRegistry listActiveRuns', () => {
  it('excludes turn-complete entries from listActiveRuns', () => {
    resetActiveRunsForTests()
    const runId = 'session-run'
    const first = registerRunAbort(runId, '/ws')
    expect(listActiveRuns()).toEqual([{ runId, workspacePath: '/ws', invokeId: first.invokeId }])
    expect(isActive(runId)).toBe(true)

    markRunTurnComplete(runId, first.invokeId)
    expect(isActive(runId)).toBe(false)
    expect(listActiveRuns()).toEqual([])

    const second = registerRunAbort(runId, '/ws')
    expect(listActiveRuns()).toEqual([{ runId, workspacePath: '/ws', invokeId: second.invokeId }])

    clearRunAbort(runId, first.invokeId)
    expect(listActiveRuns()).toEqual([{ runId, workspacePath: '/ws', invokeId: second.invokeId }])

    clearRunAbort(runId, second.invokeId)
    expect(listActiveRuns()).toEqual([])
  })
})
