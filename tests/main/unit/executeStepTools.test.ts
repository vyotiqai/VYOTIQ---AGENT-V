import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AgentEvent } from '@shared/ipc'

const executeTool = vi.hoisted(() => vi.fn())

vi.mock('@main/agent/tools', () => ({
  executeTool: (...args: unknown[]) => executeTool(...args)
}))

import { executeStepToolCalls } from '@main/agent/executeStepTools'

type TestCtx = Parameters<typeof executeStepToolCalls>[1]

function makeCtx(signal: AbortSignal, failedToolKeys = new Map<string, number>()) {
  const events: AgentEvent[] = []
  const messages: unknown[] = []
  return {
    ctx: {
      runId: 'run-1',
      runDir: '/tmp/run',
      workspace: '/tmp/ws',
      signal,
      failedToolKeys,
      appendMessage: (msg: unknown) => messages.push(msg),
      appendEvent: (ev: AgentEvent) => events.push(ev)
    } as unknown as TestCtx,
    events,
    messages
  }
}

describe('executeStepToolCalls', () => {
  beforeEach(() => {
    executeTool.mockReset()
  })

  it('preserves tool result order for parallel read-only calls', async () => {
    executeTool.mockImplementation(async (name: string) => {
      return { ok: true, summary: name, content: `body:${name}` }
    })

    const { ctx } = makeCtx(new AbortController().signal)
    const outcome = await executeStepToolCalls(
      [
        { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' },
        { id: 'c2', name: 'read', arguments: '{"path":"b.ts"}' },
        { id: 'c3', name: 'search', arguments: '{"query":"foo"}' }
      ],
      ctx
    )

    expect(outcome.messages.map((m) => m.toolCallId)).toEqual(['c1', 'c2', 'c3'])
    expect(outcome.messages.map((m) => m.content)).toEqual(['body:read', 'body:read', 'body:search'])
    expect(outcome.stepToolsOk).toBe(true)
  })

  it('runs mutating tools after read-only batches in call order', async () => {
    const order: string[] = []
    executeTool.mockImplementation(async (name: string) => {
      order.push(name)
      return { ok: true, summary: name, content: name }
    })

    const { ctx } = makeCtx(new AbortController().signal)
    await executeStepToolCalls(
      [
        { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' },
        { id: 'c2', name: 'edit', arguments: '{"path":"a.ts","contents":"x"}' },
        { id: 'c3', name: 'read', arguments: '{"path":"b.ts"}' }
      ],
      ctx
    )

    expect(order).toEqual(['read', 'edit', 'read'])
  })

  it('marks pending parallel read tools cancelled when aborted mid-batch', async () => {
    const ac = new AbortController()
    let started = 0
    executeTool.mockImplementation(async () => {
      started += 1
      if (started === 1) {
        ac.abort()
        await new Promise((r) => setTimeout(r, 20))
      }
      return { ok: true, summary: 'file', content: 'ok' }
    })

    const { ctx } = makeCtx(ac.signal)
    const outcome = await executeStepToolCalls(
      [
        { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' },
        { id: 'c2', name: 'read', arguments: '{"path":"b.ts"}' },
        { id: 'c3', name: 'read', arguments: '{"path":"c.ts"}' }
      ],
      ctx
    )

    expect(outcome.stepToolsOk).toBe(false)
    const cancelled = outcome.messages.filter((m) => m.content === 'Cancelled')
    expect(cancelled.length).toBeGreaterThanOrEqual(1)
    expect(outcome.messages.map((m) => m.toolCallId)).toEqual(['c1', 'c2', 'c3'])
  })

  it('prepends repeat hint when the same path fails twice in one run', async () => {
    executeTool.mockResolvedValue({
      ok: false,
      summary: 'core/build.gradle.kts',
      content: 'File not found: core/build.gradle.kts',
      failureLogged: true
    })

    const failedToolKeys = new Map<string, number>()
    const { ctx } = makeCtx(new AbortController().signal, failedToolKeys)
    const call = { id: 'c1', name: 'read', arguments: '{"path":"core/build.gradle.kts"}' }

    await executeStepToolCalls([call], ctx)
    const second = await executeStepToolCalls([call], ctx)

    expect(second.messages[0]?.content).toMatch(/Repeated failure #2/)
    expect(second.messages[0]?.content).toMatch(/File not found/)
  })

  it('feeds a denied approval back as a tool failure without running the tool', async () => {
    executeTool.mockResolvedValue({ ok: true, summary: 'write', content: 'wrote' })

    const { ctx } = makeCtx(new AbortController().signal)
    ctx.approval = {
      authorize: async () => ({ allowed: false, reason: 'The user denied permission to run write.' })
    }
    const outcome = await executeStepToolCalls(
      [{ id: 'c1', name: 'write', arguments: '{"path":"a.ts","contents":"x"}' }],
      ctx
    )

    expect(executeTool).not.toHaveBeenCalled()
    expect(outcome.stepToolsOk).toBe(false)
    expect(outcome.messages[0]?.content).toMatch(/denied permission/)
    expect(outcome.messages[0]?.ok).toBe(false)
  })

  it('emits tool_start live and persists ok on tool messages', async () => {
    const live: AgentEvent[] = []
    executeTool.mockResolvedValue({ ok: false, summary: 'file', content: 'permission denied' })

    const { ctx, events } = makeCtx(new AbortController().signal)
    ctx.emitLiveEvent = (ev) => live.push(ev)
    const outcome = await executeStepToolCalls(
      [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }],
      ctx
    )

    expect(live.some((ev) => ev.type === 'tool_start' && ev.toolCallId === 'c1')).toBe(true)
    expect(events.some((ev) => ev.type === 'tool_start' && ev.toolCallId === 'c1')).toBe(true)
    expect(outcome.messages[0]?.ok).toBe(false)
  })

  it('runs read-only tools serially when maxParallelReadTools is 1', async () => {
    const order: string[] = []
    executeTool.mockImplementation(async (name: string) => {
      order.push(name)
      await new Promise((r) => setTimeout(r, 5))
      return { ok: true, summary: name, content: name }
    })

    const { ctx } = makeCtx(new AbortController().signal)
    ctx.maxParallelReadTools = 1
    await executeStepToolCalls(
      [
        { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' },
        { id: 'c2', name: 'read', arguments: '{"path":"b.ts"}' }
      ],
      ctx
    )

    expect(order).toEqual(['read', 'read'])
  })
})
