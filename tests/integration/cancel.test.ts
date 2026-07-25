import { describe, expect, it } from 'vitest'
import {
  registerRunAbort,
  cancelRun,
  clearRunAbort,
  resetActiveRunsForTests,
  chatCancelResult
} from '@main/agent/runRegistry'

describe('cancel registry', () => {
  it('registers, cancels, and reuses controllers', () => {
    resetActiveRunsForTests()
    const a = registerRunAbort('run-1')
    const again = registerRunAbort('run-1')
    expect(again).toBe(a)
    expect(cancelRun('run-1')).toBe(true)
    expect(a.signal.aborted).toBe(true)
    expect(cancelRun('missing')).toBe(false)
    clearRunAbort('run-1')
  })

  it('chatCancelResult is idempotent (late / missing cancel is ok)', () => {
    resetActiveRunsForTests()
    registerRunAbort('active')
    expect(chatCancelResult('active')).toEqual({ ok: true, data: true })
    expect(chatCancelResult('gone')).toEqual({ ok: true, data: true })
    clearRunAbort('active')
    expect(chatCancelResult('ephemeral')).toEqual({ ok: true, data: true })
  })
})
