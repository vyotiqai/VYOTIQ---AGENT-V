import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  registerSubagent,
  unregisterSubagent,
  disposeSubagentsForInvoke,
  disposeSubagentsForRun,
  countActiveSubagentsForInvoke,
  listActiveSubagentIds,
  resetSubagentRegistryForTests
} from '@main/agent/subagentRegistry'

describe('subagentRegistry', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
  })
  afterEach(() => {
    resetSubagentRegistryForTests()
  })

  it('registers and unregisters idempotently', () => {
    const parent = new AbortController()
    const { id, signal } = registerSubagent({
      runId: 'run-1',
      invokeId: 1,
      parentSignal: parent.signal
    })
    expect(listActiveSubagentIds()).toContain(id)
    expect(signal.aborted).toBe(false)
    expect(countActiveSubagentsForInvoke('run-1', 1)).toBe(1)
    unregisterSubagent(id)
    unregisterSubagent(id)
    expect(listActiveSubagentIds()).not.toContain(id)
    expect(countActiveSubagentsForInvoke('run-1', 1)).toBe(0)
  })

  it('aborts child when parent aborts', async () => {
    const parent = new AbortController()
    const { id, signal } = registerSubagent({
      runId: 'run-1',
      invokeId: 2,
      parentSignal: parent.signal
    })
    expect(signal.aborted).toBe(false)
    parent.abort()
    expect(signal.aborted).toBe(true)
    unregisterSubagent(id)
  })

  it('disposeSubagentsForInvoke aborts parallel children and waits for unregister', async () => {
    const parent = new AbortController()
    const a = registerSubagent({
      runId: 'run-1',
      invokeId: 3,
      parentSignal: parent.signal,
      parentToolCallId: 't1'
    })
    const b = registerSubagent({
      runId: 'run-1',
      invokeId: 3,
      parentSignal: parent.signal,
      parentToolCallId: 't2'
    })
    // Other invoke must not be disposed
    const other = registerSubagent({
      runId: 'run-1',
      invokeId: 99,
      parentSignal: parent.signal
    })
    expect(countActiveSubagentsForInvoke('run-1', 3)).toBe(2)

    const disposePromise = disposeSubagentsForInvoke('run-1', 3)
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    expect(other.signal.aborted).toBe(false)

    // Simulate subagent finally blocks
    queueMicrotask(() => {
      unregisterSubagent(a.id)
      unregisterSubagent(b.id)
    })
    const n = await disposePromise
    expect(n).toBe(2)
    expect(countActiveSubagentsForInvoke('run-1', 3)).toBe(0)
    expect(countActiveSubagentsForInvoke('run-1', 99)).toBe(1)
    unregisterSubagent(other.id)
  })

  it('disposeSubagentsForRun aborts all invokes for a run', async () => {
    const parent = new AbortController()
    const a = registerSubagent({
      runId: 'run-x',
      invokeId: 1,
      parentSignal: parent.signal
    })
    const b = registerSubagent({
      runId: 'run-x',
      invokeId: 2,
      parentSignal: parent.signal
    })
    const otherRun = registerSubagent({
      runId: 'run-y',
      invokeId: 1,
      parentSignal: parent.signal
    })

    const disposePromise = disposeSubagentsForRun('run-x')
    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    expect(otherRun.signal.aborted).toBe(false)
    queueMicrotask(() => {
      unregisterSubagent(a.id)
      unregisterSubagent(b.id)
    })
    await disposePromise
    expect(countActiveSubagentsForInvoke('run-x', 1)).toBe(0)
    expect(countActiveSubagentsForInvoke('run-x', 2)).toBe(0)
    unregisterSubagent(otherRun.id)
  })

  it('registers already-aborted when parent already aborted', () => {
    const parent = new AbortController()
    parent.abort()
    const { id, signal } = registerSubagent({
      runId: 'run-1',
      invokeId: 1,
      parentSignal: parent.signal
    })
    expect(signal.aborted).toBe(true)
    unregisterSubagent(id)
  })
})
