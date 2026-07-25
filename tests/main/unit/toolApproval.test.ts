import { describe, expect, it, beforeEach } from 'vitest'
import {
  cancelPendingApprovals,
  createApprovalGate,
  isToolGated,
  registerApprovalSender,
  resetToolApprovalForTests,
  resolveToolApproval
} from '@main/agent/toolApproval'
import type { ToolApprovalRequest } from '@shared/ipc'

const READ = { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }
const WRITE = { id: 'c2', name: 'write', arguments: '{"path":"a.ts","contents":"x"}' }

describe('isToolGated', () => {
  const none = new Set<string>()

  it('never gates when approval is off', () => {
    expect(isToolGated('write', 'off', none, [])).toBe(false)
  })

  it('gates only mutating tools in mutating mode', () => {
    expect(isToolGated('write', 'mutating', none, [])).toBe(true)
    expect(isToolGated('read', 'mutating', none, [])).toBe(false)
  })

  it('gates reads too in all mode', () => {
    expect(isToolGated('read', 'all', none, [])).toBe(true)
  })

  it('skips tools on either allowlist', () => {
    expect(isToolGated('write', 'all', new Set(['write']), [])).toBe(false)
    expect(isToolGated('write', 'all', none, ['write'])).toBe(false)
  })
})

describe('createApprovalGate', () => {
  beforeEach(() => {
    resetToolApprovalForTests()
  })

  it('allows ungated tools without asking', async () => {
    let asked = 0
    const gate = createApprovalGate({
      runId: 'run-1',
      mode: 'mutating',
      workspaceAllowlist: [],
      signal: new AbortController().signal,
      ask: async () => {
        asked += 1
        return 'once'
      }
    })

    expect(await gate.authorize(READ)).toEqual({ allowed: true })
    expect(asked).toBe(0)
  })

  it('returns a denial the model can read back', async () => {
    const gate = createApprovalGate({
      runId: 'run-1',
      mode: 'mutating',
      workspaceAllowlist: [],
      signal: new AbortController().signal,
      ask: async () => 'deny'
    })

    const verdict = await gate.authorize(WRITE)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toMatch(/denied permission to run write/)
  })

  it('asks once per tool after "allow for session"', async () => {
    let asked = 0
    const gate = createApprovalGate({
      runId: 'run-1',
      mode: 'all',
      workspaceAllowlist: [],
      signal: new AbortController().signal,
      ask: async () => {
        asked += 1
        return 'session'
      }
    })

    await gate.authorize(WRITE)
    await gate.authorize(WRITE)
    expect(asked).toBe(1)
  })

  it('persists "always allow" for the next run', async () => {
    const persisted: string[] = []
    const gate = createApprovalGate({
      runId: 'run-1',
      mode: 'mutating',
      workspaceAllowlist: [],
      signal: new AbortController().signal,
      persistAlways: (name) => persisted.push(name),
      ask: async () => 'always'
    })

    await gate.authorize(WRITE)
    expect(persisted).toEqual(['write'])
  })

  it('rides the renderer round trip', async () => {
    const seen: ToolApprovalRequest[] = []
    registerApprovalSender('run-1', (request) => {
      seen.push(request)
    })
    const gate = createApprovalGate({
      runId: 'run-1',
      mode: 'mutating',
      workspaceAllowlist: [],
      signal: new AbortController().signal
    })

    const verdict = gate.authorize(WRITE)
    await Promise.resolve()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.name).toBe('write')
    expect(seen[0]!.mutating).toBe(true)

    expect(resolveToolApproval({ requestId: seen[0]!.requestId, decision: 'once' })).toBe(true)
    expect(await verdict).toEqual({ allowed: true })
  })

  it('denies when no window is listening rather than hanging', async () => {
    const gate = createApprovalGate({
      runId: 'run-nobody',
      mode: 'mutating',
      workspaceAllowlist: [],
      signal: new AbortController().signal
    })
    const verdict = await gate.authorize(WRITE)
    expect(verdict.allowed).toBe(false)
  })

  it('releases a waiting prompt when the run is cancelled', async () => {
    registerApprovalSender('run-1', () => {})
    const controller = new AbortController()
    const gate = createApprovalGate({
      runId: 'run-1',
      mode: 'mutating',
      workspaceAllowlist: [],
      signal: controller.signal
    })

    const verdict = gate.authorize(WRITE)
    await Promise.resolve()
    controller.abort()
    expect((await verdict).allowed).toBe(false)
  })

  it('releases prompts left over when a run ends', async () => {
    registerApprovalSender('run-1', () => {})
    const gate = createApprovalGate({
      runId: 'run-1',
      mode: 'mutating',
      workspaceAllowlist: [],
      signal: new AbortController().signal
    })

    const verdict = gate.authorize(WRITE)
    await Promise.resolve()
    cancelPendingApprovals('run-1')
    expect((await verdict).allowed).toBe(false)
  })
})
