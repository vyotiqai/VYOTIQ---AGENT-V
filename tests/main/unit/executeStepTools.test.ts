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

  it('discards late parallel successes after abort', async () => {
    const ac = new AbortController()
    let started = 0
    executeTool.mockImplementation(async () => {
      started += 1
      if (started === 1) {
        ac.abort()
        await new Promise((r) => setTimeout(r, 30))
        return { ok: true, summary: 'late', content: 'should-not-persist' }
      }
      return { ok: true, summary: 'file', content: 'ok' }
    })

    const { ctx } = makeCtx(ac.signal)
    const outcome = await executeStepToolCalls(
      [
        { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' },
        { id: 'c2', name: 'read', arguments: '{"path":"b.ts"}' }
      ],
      ctx
    )

    expect(outcome.messages.every((m) => m.content === 'Cancelled')).toBe(true)
    expect(outcome.stepToolsOk).toBe(false)
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
    executeTool.mockResolvedValue({ ok: true, summary: 'edit', content: 'wrote' })

    const { ctx } = makeCtx(new AbortController().signal)
    ctx.approval = {
      authorize: async () => ({ allowed: false, reason: 'The user denied permission to run edit.' })
    }
    const outcome = await executeStepToolCalls(
      [{ id: 'c1', name: 'edit', arguments: '{"path":"a.ts","contents":"x"}' }],
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
    expect(live.some((ev) => ev.type === 'tool_result' && ev.toolCallId === 'c1')).toBe(true)
    expect(events.some((ev) => ev.type === 'tool_start' && ev.toolCallId === 'c1')).toBe(true)
    expect(outcome.messages[0]?.ok).toBe(false)
  })

  it('persists full tool output before emitting the live result', async () => {
    const order: string[] = []
    executeTool.mockResolvedValue({ ok: true, summary: 'big', content: 'full output' })
    const { ctx } = makeCtx(new AbortController().signal)
    ctx.appendMessage = async () => {
      await Promise.resolve()
      order.push('persisted')
    }
    ctx.emitLiveEvent = (event) => {
      if (event.type === 'tool_result') order.push('emitted')
    }

    await executeStepToolCalls(
      [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }],
      ctx
    )

    expect(order).toEqual(['persisted', 'emitted'])
  })

  it('routes parallel subagent live updates to distinct parentToolCallIds', async () => {
    const live: AgentEvent[] = []
    executeTool.mockImplementation(
      async (
        _name: string,
        _args: string,
        _workspace: string,
        _signal: AbortSignal,
        context?: {
          onProgress?: (u: { kind: 'tool'; text: string }) => void
          onSubagentContextUsage?: (u: {
            step: number
            estimatedTokens: number
            contextWindow: number
            contentWindow: number
            model: string
          }) => void
        }
      ) => {
        context?.onProgress?.({ kind: 'tool', text: 'reading' })
        context?.onSubagentContextUsage?.({
          step: 1,
          estimatedTokens: 1000,
          contextWindow: 128_000,
          contentWindow: 110_000,
          model: 'm'
        })
        await new Promise((r) => setTimeout(r, 10))
        return { ok: true, summary: 'task', content: 'report' }
      }
    )

    const { ctx } = makeCtx(new AbortController().signal)
    ctx.emitLiveEvent = (ev) => live.push(ev)
    const outcome = await executeStepToolCalls(
      [
        { id: 'sa1', name: 'subagent', arguments: '{"task":"a"}' },
        { id: 'sa2', name: 'subagent', arguments: '{"task":"b"}' }
      ],
      ctx
    )

    expect(outcome.messages.map((m) => m.toolCallId)).toEqual(['sa1', 'sa2'])
    const updates = live.filter((ev) => ev.type === 'subagent_update')
    const usages = live.filter((ev) => ev.type === 'subagent_context_usage')
    expect(updates.map((ev) => (ev.type === 'subagent_update' ? ev.parentToolCallId : ''))).toEqual(
      expect.arrayContaining(['sa1', 'sa2'])
    )
    expect(usages.map((ev) => (ev.type === 'subagent_context_usage' ? ev.parentToolCallId : ''))).toEqual(
      expect.arrayContaining(['sa1', 'sa2'])
    )
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

  it('keeps parallel reads when an approval gate is present', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    let authorizeCalls = 0

    executeTool.mockImplementation(async () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 15))
      concurrent -= 1
      return { ok: true, summary: 'file', content: 'ok' }
    })

    const { ctx } = makeCtx(new AbortController().signal)
    ctx.approval = {
      authorize: async () => {
        authorizeCalls += 1
        return { allowed: true }
      }
    }

    await executeStepToolCalls(
      [
        { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' },
        { id: 'c2', name: 'read', arguments: '{"path":"b.ts"}' },
        { id: 'c3', name: 'read', arguments: '{"path":"c.ts"}' }
      ],
      ctx
    )

    // Approval gates each tool; read-only batches still run in parallel.
    expect(authorizeCalls).toBe(3)
    expect(maxConcurrent).toBeGreaterThan(1)
  })

  it('emits tool_result live for each parallel tool as it finishes', async () => {
    const live: AgentEvent[] = []
    const finished: string[] = []

    executeTool.mockImplementation(async (_name: string, args: string) => {
      const path = JSON.parse(args).path as string
      if (path === 'b.ts') await new Promise((r) => setTimeout(r, 40))
      else await new Promise((r) => setTimeout(r, 5))
      finished.push(path)
      return { ok: true, summary: path, content: `body:${path}` }
    })

    const { ctx } = makeCtx(new AbortController().signal)
    ctx.emitLiveEvent = (ev) => {
      if (ev.type === 'tool_result') live.push(ev)
    }

    await executeStepToolCalls(
      [
        { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' },
        { id: 'c2', name: 'read', arguments: '{"path":"b.ts"}' }
      ],
      ctx
    )

    expect(live.map((ev) => (ev.type === 'tool_result' ? ev.toolCallId : ''))).toEqual(['c1', 'c2'])
    expect(finished.indexOf('a.ts')).toBeLessThan(finished.indexOf('b.ts'))
  })
})
