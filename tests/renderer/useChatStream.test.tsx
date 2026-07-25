/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useChatStream } from '@renderer/shared/hooks/useChatStream'
import type { AgentEvent } from '@shared/ipc'

type Handler = (event: AgentEvent) => void

describe('useChatStream', () => {
  let handler: Handler | null = null
  const chatStart = vi.fn()
  const chatCancel = vi.fn()

  beforeEach(() => {
    handler = null
    chatStart.mockReset()
    chatCancel.mockReset()
    chatStart.mockResolvedValue({ ok: true, data: { runId: 'run-1' } })
    chatCancel.mockResolvedValue({ ok: true, data: true })

    // @ts-expect-error test bridge
    window.vyotiq = {
      chatStart,
      chatCancel,
      onChatEvent: (h: Handler) => {
        handler = h
        return () => {
          handler = null
        }
      }
    }
  })

  it('clears state when workspace changes', async () => {
    const { result, rerender } = renderHook(
      ({ ws }: { ws: string | null }) => useChatStream(ws),
      { initialProps: { ws: '/a' as string | null } }
    )

    await act(async () => {
      await result.current.send('hello')
    })
    expect(result.current.items.length).toBeGreaterThan(0)

    rerender({ ws: '/b' })
    expect(result.current.items).toEqual([])
    expect(result.current.messages).toEqual([])
  })

  it('includes tool history in the next chatStart payload', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('use tools')
    })

    await act(async () => {
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts',
        ok: true,
        content: 'body'
      })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'done'
      })
      handler?.({ type: 'status', runId: 'run-1', status: 'done' })
    })

    chatStart.mockClear()
    chatStart.mockResolvedValue({ ok: true, data: { runId: 'run-2' } })

    await act(async () => {
      await result.current.send('follow up')
    })

    const payload = chatStart.mock.calls[0][0]
    expect(payload.messages.some((m: { role: string }) => m.role === 'tool')).toBe(true)
    expect(
      payload.messages.some(
        (m: { role: string; toolCalls?: unknown[] }) =>
          m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0
      )
    ).toBe(true)
  })

  it('queues cancel when stop races chatStart', async () => {
    let resolveStart: (v: unknown) => void = () => undefined
    chatStart.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )

    const { result } = renderHook(() => useChatStream('/ws'))

    let sendPromise: Promise<void>
    await act(async () => {
      sendPromise = result.current.send('late')
    })

    await act(async () => {
      await result.current.stop()
    })

    await act(async () => {
      resolveStart({ ok: true, data: { runId: 'late-run' } })
      await sendPromise!
    })

    await waitFor(() => {
      expect(chatCancel).toHaveBeenCalledWith('late-run')
    })
  })

  it('cancels when reset races chatStart before runId exists', async () => {
    let resolveStart: (v: unknown) => void = () => undefined
    chatStart.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )

    const { result } = renderHook(() => useChatStream('/ws'))

    let sendPromise: Promise<void>
    await act(async () => {
      sendPromise = result.current.send('reset-race')
    })

    await act(async () => {
      result.current.reset()
    })

    expect(result.current.items).toEqual([])
    expect(result.current.running).toBe(false)

    await act(async () => {
      resolveStart({ ok: true, data: { runId: 'orphan-run' } })
      await sendPromise!
    })

    await waitFor(() => {
      expect(chatCancel).toHaveBeenCalledWith('orphan-run')
    })
    expect(result.current.running).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('rolls back optimistic turn when chatStart fails', async () => {
    chatStart.mockResolvedValueOnce({ ok: false, error: 'start failed' })
    const { result } = renderHook(() => useChatStream('/ws'))

    let ok = true
    await act(async () => {
      ok = await result.current.send('lost message')
    })

    expect(ok).toBe(false)
    expect(result.current.running).toBe(false)
    expect(result.current.error).toBe('start failed')
    expect(result.current.items).toEqual([])
    expect(result.current.messages).toEqual([])
  })

  it('ignores late events after a run finishes', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('hi')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'hello' })
      handler?.({ type: 'assistant_message', runId: 'run-1', content: 'hello' })
      handler?.({ type: 'status', runId: 'run-1', status: 'done' })
    })

    const count = result.current.items.length

    await act(async () => {
      handler?.({ type: 'text_delta', runId: 'run-1', text: ' LATE' })
      handler?.({ type: 'error', runId: 'run-1', message: 'should ignore' })
    })

    expect(result.current.items).toHaveLength(count)
    expect(result.current.error).toBeNull()
    expect(result.current.running).toBe(false)
  })

  it('merges tool_start into an existing tool_call_delta row', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('read')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        argumentsDelta: '{"path":"a.ts"}'
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts'
      })
    })

    const tools = result.current.items.filter((i) => i.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      kind: 'tool',
      id: 'c1',
      tool: {
        name: 'read',
        summary: 'a.ts',
        status: 'running',
        argsPreview: '{"path":"a.ts"}'
      }
    })
  })

  it('loadTranscript preserves tool rows from messages', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      result.current.loadTranscript([
        { role: 'user', content: 'read file' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
        },
        { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'contents' },
        { role: 'assistant', content: 'here you go' }
      ])
    })

    expect(result.current.items.map((i) => i.kind)).toEqual(['message', 'tool', 'message'])
    const tool = result.current.items[1]
    expect(tool).toMatchObject({
      kind: 'tool',
      tool: { name: 'read', summary: 'a.ts', status: 'done', content: 'contents' }
    })
  })

  it('cancels an active run when loading a transcript', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('active')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
    })

    await act(async () => {
      result.current.loadTranscript([{ role: 'user', content: 'prior' }])
    })

    expect(chatCancel).toHaveBeenCalledWith('run-1')
    expect(result.current.running).toBe(false)
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({ role: 'user', content: 'prior' })
  })

  it('ignores orphan stream events after loadTranscript races chatStart', async () => {
    let resolveStart: (v: unknown) => void = () => undefined
    chatStart.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )

    const { result } = renderHook(() => useChatStream('/ws'))

    let sendPromise: Promise<void>
    await act(async () => {
      sendPromise = result.current.send('race')
    })

    await act(async () => {
      result.current.loadTranscript([{ role: 'user', content: 'loaded' }])
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({ content: 'loaded' })

    await act(async () => {
      handler?.({ type: 'text_delta', runId: 'orphan-run', text: 'leak' })
      resolveStart({ ok: true, data: { runId: 'orphan-run' } })
      await sendPromise!
    })

    await waitFor(() => {
      expect(chatCancel).toHaveBeenCalledWith('orphan-run')
    })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({ content: 'loaded' })
  })

  it('marks orphan running tools failed when a run is cancelled', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('tools')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        argumentsDelta: '{"path":"a.ts"}'
      })
      handler?.({ type: 'status', runId: 'run-1', status: 'cancelled' })
    })

    const tool = result.current.items.find((i) => i.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      tool: { status: 'fail', content: 'Cancelled' }
    })
  })

  it('places assistant text before tools when tool deltas arrive first', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('read with preamble')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
    })

    await act(async () => {
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        argumentsDelta: '{"path":"a.ts"}'
      })
    })

    await act(async () => {
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'Reading now.' })
    })

    await act(async () => {
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'Reading now.',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      })
    })

    expect(result.current.items.map((i) => i.kind)).toEqual(['message', 'message', 'tool'])
    const assistant = result.current.items[1]
    expect(assistant).toMatchObject({
      kind: 'message',
      role: 'assistant',
      content: 'Reading now.'
    })
  })

  it('creates a tool row from tool_result when no prior delta or start', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('tool only')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts',
        ok: true,
        content: 'body'
      })
    })

    const tool = result.current.items.find((i) => i.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      id: 'c1',
      tool: { name: 'read', summary: 'a.ts', status: 'done', content: 'body' }
    })
  })
})
