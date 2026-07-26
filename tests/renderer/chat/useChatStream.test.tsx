/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useChatStream } from '@renderer/lib/hooks/useChatStream'
import { buildTranscriptRows } from '@renderer/features/chat/utils/transcriptRows'
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
    chatStart.mockResolvedValue({ ok: true, data: { runId: 'run-1', invokeId: 1 } })
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
    chatStart.mockResolvedValue({ ok: true, data: { runId: 'run-1', invokeId: 1 } })

    await act(async () => {
      await result.current.send('follow up')
    })

    const payload = chatStart.mock.calls[0][0]
    expect(payload.runId).toBe('run-1')
    expect(payload.incremental).toBe(true)
    expect(payload.newMessages).toHaveLength(1)
    expect(payload.newMessages[0]).toMatchObject({ role: 'user', content: 'follow up' })
    expect(result.current.messages.some((m) => m.role === 'tool')).toBe(true)
    expect(
      result.current.messages.some(
        (m) => m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0
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

  it('hydrateTranscript does not clobber an active run', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('active')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
    })
    chatCancel.mockClear()

    await act(async () => {
      result.current.hydrateTranscript([
        { role: 'user', content: 'restored' },
        { role: 'assistant', content: 'ok' }
      ])
    })

    expect(chatCancel).not.toHaveBeenCalled()
    expect(result.current.running).toBe(true)
    expect(result.current.runId).toBe('run-1')
    expect(result.current.items[0]).toMatchObject({ role: 'user', content: 'active' })
    expect(result.current.items.some((i) => i.kind === 'message' && i.content === 'restored')).toBe(
      false
    )
  })

  it('hydrateTranscript loads messages when the controller is idle', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      result.current.hydrateTranscript([
        { role: 'user', content: 'restored' },
        { role: 'assistant', content: 'ok' }
      ])
    })

    expect(result.current.running).toBe(false)
    expect(result.current.items.map((i) => (i.kind === 'message' ? i.content : i.kind))).toEqual([
      'restored',
      'ok'
    ])
  })

  it('restores error banner from persisted error events when idle', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      result.current.hydrateTranscript([{ role: 'user', content: 'x' }], [
        {
          at: '2026-07-24T12:00:00.000Z',
          event: { type: 'error', runId: 'run-1', message: 'Provider exploded', code: 'PROVIDER_STREAM' }
        }
      ])
    })

    expect(result.current.error).toBe('Provider exploded')
  })

  it('sets a fallback error when status is error without an error event', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('fail')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'status', runId: 'run-1', status: 'error' })
    })

    expect(result.current.running).toBe(false)
    expect(result.current.error).toBe('Run failed')
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

  it('marks orphan running tools failed when a run errors', async () => {
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
      handler?.({ type: 'status', runId: 'run-1', status: 'error' })
    })

    const tool = result.current.items.find((i) => i.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      tool: { status: 'fail', content: 'Interrupted' }
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

  it('appends next-iteration text after completed tools instead of reshuffling', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('multi step')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'First look.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'First look.',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts'
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts',
        ok: true,
        content: 'ok'
      })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'Next batch.' })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    expect(result.current.items.map((i) => i.kind)).toEqual([
      'message',
      'message',
      'tool',
      'message'
    ])
    expect(result.current.items[1]).toMatchObject({ content: 'First look.' })
    expect(result.current.items[2]).toMatchObject({ kind: 'tool' })
    expect(result.current.items[3]).toMatchObject({ content: 'Next batch.' })
  })

  it('inserts tools directly after their assistant turn, not at the timeline tail', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('multi step')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'First look.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'First look.',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts'
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts',
        ok: true,
        content: 'ok'
      })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'Next batch.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'Next batch.',
        toolCalls: [{ id: 'c2', name: 'read', arguments: '{"path":"b.ts"}' }]
      })
    })

    expect(result.current.items.map((i) => (i.kind === 'message' ? i.content : i.tool.summary))).toEqual([
      'multi step',
      'First look.',
      'a.ts',
      'Next batch.',
      'b.ts'
    ])
  })

  it('does not mark live tools failed when next-iteration text streams', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('list files')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'pending_0',
        name: 'terminal',
        argumentsDelta: '{"command":"dir"}'
      })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'First pass.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'First pass.',
        toolCalls: [{ id: 'c1', name: 'terminal', arguments: '{"command":"dir"}' }]
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'terminal',
        summary: 'dir',
        ok: true,
        content: 'listed'
      })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'pending_1',
        name: 'read',
        argumentsDelta: '{"path":"a.ts"}'
      })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'Second pass.' })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    const live = result.current.items.find(
      (i) => i.kind === 'tool' && i.tool.name === 'read' && i.tool.status === 'running'
    )
    expect(live).toBeTruthy()
    if (live?.kind === 'tool') {
      expect(live.tool.status).toBe('running')
    }
  })

  it('merges pending tool_call_delta rows when assistant_message arrives', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('read')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'Reading.' })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'pending_0',
        name: 'read',
        argumentsDelta: '{"path":"a.ts"}'
      })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'Reading.',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      })
    })

    const tools = result.current.items.filter((i) => i.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      id: 'c1',
      tool: { id: 'c1', name: 'read', summary: 'a.ts', status: 'running' }
    })
  })

  it('does not stack later assistant text before orphaned live tools', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('list files')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'pending_0',
        name: 'terminal',
        argumentsDelta: '{"command":"dir"}'
      })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'First pass.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'First pass.',
        toolCalls: [{ id: 'c1', name: 'terminal', arguments: '{"command":"dir"}' }]
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'terminal',
        summary: 'dir'
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'terminal',
        summary: 'dir',
        ok: true,
        content: 'listed'
      })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'pending_1',
        name: 'read',
        argumentsDelta: '{}'
      })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'Second pass.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'Second pass.',
        toolCalls: [{ id: 'c2', name: 'read', arguments: '{}' }]
      })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'Third pass.' })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    const kinds = result.current.items.map((i) => i.kind)
    const firstToolIdx = kinds.indexOf('tool')
    const secondAssistantIdx = result.current.items.findIndex(
      (i) => i.kind === 'message' && i.role === 'assistant' && i.content === 'Second pass.'
    )
    const thirdAssistantIdx = result.current.items.findIndex(
      (i) => i.kind === 'message' && i.role === 'assistant' && i.content === 'Third pass.'
    )

    expect(firstToolIdx).toBeGreaterThan(-1)
    expect(secondAssistantIdx).toBeGreaterThan(firstToolIdx)
    expect(thirdAssistantIdx).toBeGreaterThan(firstToolIdx)
    expect(result.current.items.map((i) => (i.kind === 'message' ? i.content : i.kind))).toEqual([
      'list files',
      'First pass.',
      'tool',
      'tool',
      'Second pass.',
      'Third pass.'
    ])
  })

  it('keeps multi-tool steps interleaved across iterations', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('analyze codebase')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'Reading configs.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'Reading configs.',
        toolCalls: [
          { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' },
          { id: 'c2', name: 'read', arguments: '{"path":"b.ts"}' }
        ]
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts'
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c2',
        name: 'read',
        summary: 'b.ts'
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts',
        ok: true,
        content: 'a'
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c2',
        name: 'read',
        summary: 'b.ts',
        ok: true,
        content: 'b'
      })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'Exploring sources.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'Exploring sources.',
        toolCalls: [{ id: 'c3', name: 'search', arguments: '{"query":".kt"}' }]
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c3',
        name: 'search',
        summary: '.kt'
      })
    })

    expect(result.current.items.map((i) => (i.kind === 'message' ? i.content : i.tool.summary))).toEqual([
      'analyze codebase',
      'Reading configs.',
      'a.ts',
      'b.ts',
      'Exploring sources.',
      '.kt'
    ])
    const secondTool = result.current.items[2]
    expect(secondTool.kind).toBe('tool')
    if (secondTool.kind === 'tool') {
      expect(secondTool.groupTiming?.endedAt).toBeTypeOf('number')
    }
    const thirdIterationTool = result.current.items[5]
    expect(thirdIterationTool).toMatchObject({ kind: 'tool', id: 'c3' })
    if (thirdIterationTool.kind === 'tool') {
      expect(thirdIterationTool.groupTiming?.startedAt).toBeTypeOf('number')
      expect(thirdIterationTool.groupTiming?.startedAt).toBeGreaterThanOrEqual(
        secondTool.kind === 'tool' ? (secondTool.groupTiming?.startedAt ?? 0) : 0
      )
    }
  })

  it('migrates pending tool rows when canonical ids arrive', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('read')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'pending_0',
        name: 'read',
        argumentsDelta: '{"path":"a.ts"}'
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'call-real',
        name: 'read',
        summary: 'a.ts'
      })
    })

    const tools = result.current.items.filter((i) => i.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      id: 'call-real',
      tool: {
        id: 'call-real',
        name: 'read',
        summary: 'a.ts',
        status: 'running',
        argsPreview: '{"path":"a.ts"}'
      }
    })
  })

  it('migrates parallel pending tool rows by pending index', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('parallel tools')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'pending_0',
        name: 'read',
        argumentsDelta: '{"path":"a.ts"}'
      })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'pending_1',
        name: 'read',
        argumentsDelta: '{"path":"b.ts"}'
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'call-a',
        name: 'read',
        summary: 'a.ts'
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'call-b',
        name: 'read',
        summary: 'b.ts'
      })
    })

    const tools = result.current.items.filter((i) => i.kind === 'tool')
    expect(tools).toHaveLength(2)
    expect(tools[0]).toMatchObject({
      id: 'call-a',
      tool: { id: 'call-a', summary: 'a.ts', argsPreview: '{"path":"a.ts"}' }
    })
    expect(tools[1]).toMatchObject({
      id: 'call-b',
      tool: { id: 'call-b', summary: 'b.ts', argsPreview: '{"path":"b.ts"}' }
    })
  })

  it('gives every step of a turn its own reasoning row, in place', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('refactor')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'thinking_delta', runId: 'run-1', text: 'First I read.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: '',
        thinking: 'First I read.',
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
      handler?.({ type: 'thinking_delta', runId: 'run-1', text: 'Now I edit.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: '',
        thinking: 'Now I edit.',
        toolCalls: [{ id: 'c2', name: 'edit', arguments: '{"path":"a.ts"}' }]
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c2',
        name: 'edit',
        summary: 'a.ts',
        ok: true,
        content: 'ok'
      })
      handler?.({ type: 'assistant_message', runId: 'run-1', content: 'Refactored.' })
      handler?.({ type: 'status', runId: 'run-1', status: 'done' })
    })

    const thinkingRows = result.current.items.filter((i) => i.kind === 'message' && i.thinking)
    expect(thinkingRows.map((row) => row.kind === 'message' && row.thinking)).toEqual([
      'First I read.',
      'Now I edit.'
    ])

    // Each step reads top to bottom: what the model thought, then what it did.
    const shape = result.current.items.map((item) =>
      item.kind === 'tool' ? `tool:${item.tool.name}` : item.thinking || item.content
    )
    expect(shape).toEqual([
      'refactor',
      'First I read.',
      'tool:read',
      'Now I edit.',
      'tool:edit',
      'Refactored.'
    ])

    // Which is what the transcript renders: reasoning inline, per step.
    expect(buildTranscriptRows(result.current.items).map((row) => row.kind)).toEqual([
      'user',
      'turn',
      'thinking',
      'activity',
      'thinking',
      'card',
      'text'
    ])
  })

  it('renders narration, reasoning and a command card while the run is still live', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('audit it')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'thinking_delta', runId: 'run-1', text: 'Start with the router.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: '',
        thinking: 'Start with the router.',
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
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'The table is built up front.' })
      handler?.({
        type: 'assistant_message',
        runId: 'run-1',
        content: 'The table is built up front.',
        toolCalls: [{ id: 'c2', name: 'terminal', arguments: '{"command":"npm test"}' }]
      })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c2',
        name: 'terminal',
        summary: 'npm test'
      })
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    const rows = buildTranscriptRows(result.current.items)
    expect(rows.map((row) => row.kind)).toEqual([
      'user',
      'turn',
      'thinking',
      'activity',
      'text',
      'card'
    ])
    const narration = rows.find((row) => row.kind === 'text')
    expect(narration?.kind === 'text' && narration.item.content).toBe(
      'The table is built up front.'
    )
    const card = rows.find((row) => row.kind === 'card')
    expect(card?.kind === 'card' && card.item.tool.status).toBe('running')
  })

  it('completes the live row when a tool_result id drifts from its tool_start', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('read')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'call-start',
        name: 'read',
        summary: 'a.ts'
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'call-drifted',
        name: 'read',
        summary: 'a.ts',
        ok: true,
        content: 'body'
      })
    })

    const tools = result.current.items.filter((i) => i.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      id: 'call-drifted',
      tool: { id: 'call-drifted', name: 'read', status: 'done', content: 'body' }
    })
  })

  it('exposes pendingRun while chatStart is in flight', async () => {
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
      sendPromise = result.current.send('starting')
    })

    expect(result.current.pendingRun).toBe(true)
    expect(result.current.runId).toBeNull()

    await act(async () => {
      resolveStart({ ok: true, data: { runId: 'run-1', invokeId: 1 } })
      await sendPromise!
    })

    expect(result.current.pendingRun).toBe(false)
    expect(result.current.runId).toBe('run-1')
  })

  it('ignores stale terminal from a prior turn after follow-up send starts', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('first')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'assistant_message', runId: 'run-1', content: 'done' })
      handler?.({ type: 'status', runId: 'run-1', status: 'done' })
    })

    expect(result.current.running).toBe(false)

    chatStart.mockResolvedValue({ ok: true, data: { runId: 'run-1', invokeId: 1 } })

    await act(async () => {
      await result.current.send('follow up')
    })

    expect(result.current.running).toBe(true)

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'done' })
    })

    expect(result.current.running).toBe(true)

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c2',
        name: 'terminal',
        summary: 'dir'
      })
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c2',
        name: 'terminal',
        summary: 'dir',
        ok: true,
        content: 'listed'
      })
      handler?.({ type: 'assistant_message', runId: 'run-1', content: 'here' })
      handler?.({ type: 'status', runId: 'run-1', status: 'done' })
    })

    expect(result.current.running).toBe(false)
    const liveTool = result.current.items.find(
      (i) => i.kind === 'tool' && i.tool.status === 'running'
    )
    expect(liveTool).toBeUndefined()
  })

  it('keeps the live turn streaming when a prior invoke terminates late', async () => {
    chatStart.mockResolvedValue({ ok: true, data: { runId: 'run-1', invokeId: 1 } })
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('first')
    })
    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running', invokeId: 1 })
      handler?.({ type: 'assistant_message', runId: 'run-1', content: 'done', invokeId: 1 })
      handler?.({ type: 'status', runId: 'run-1', status: 'done', invokeId: 1 })
    })
    expect(result.current.running).toBe(false)

    chatStart.mockResolvedValue({ ok: true, data: { runId: 'run-1', invokeId: 2 } })
    await act(async () => {
      await result.current.send('follow up')
    })

    // The live turn is already past `running`, which is what defeats a sequence-only guard.
    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running', invokeId: 2 })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c9',
        name: 'read',
        summary: 'a.ts',
        invokeId: 2
      })
      handler?.({ type: 'status', runId: 'run-1', status: 'done', invokeId: 1 })
    })

    expect(result.current.running).toBe(true)
    expect(
      result.current.items.some((i) => i.kind === 'tool' && i.tool.status === 'running')
    ).toBe(true)

    await act(async () => {
      handler?.({
        type: 'tool_result',
        runId: 'run-1',
        toolCallId: 'c9',
        name: 'read',
        summary: 'a.ts',
        ok: true,
        content: 'body',
        invokeId: 2
      })
      handler?.({ type: 'assistant_message', runId: 'run-1', content: 'here', invokeId: 2 })
      handler?.({ type: 'status', runId: 'run-1', status: 'done', invokeId: 2 })
    })

    expect(result.current.running).toBe(false)
    expect(
      result.current.items.some((i) => i.kind === 'tool' && i.tool.status === 'running')
    ).toBe(false)
    expect(
      result.current.items.some((i) => i.kind === 'tool' && i.tool.status === 'done')
    ).toBe(true)
  })

  it('passes the same runId on follow-up send', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('first')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'assistant_message', runId: 'run-1', content: 'ok' })
      handler?.({ type: 'status', runId: 'run-1', status: 'done' })
    })

    chatStart.mockClear()
    chatStart.mockResolvedValue({ ok: true, data: { runId: 'run-1', invokeId: 1 } })

    await act(async () => {
      await result.current.send('follow up')
    })

    expect(chatStart).toHaveBeenCalledWith(
      expect.objectContaining({
        incremental: true,
        newMessages: [expect.objectContaining({ role: 'user', content: 'follow up' })],
        runId: 'run-1',
        workspacePath: '/ws'
      })
    )
    expect(result.current.runId).toBe('run-1')
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

  it('recovers from disk when chatCancel returns not found', async () => {
    const listActiveRuns = vi.fn()
    const loadRun = vi.fn()
    const loadRunEvents = vi.fn()
    chatCancel.mockResolvedValue({ ok: false, error: 'Run not found' })
    listActiveRuns.mockResolvedValue({ ok: true, data: [] })
    loadRun.mockResolvedValue({
      ok: true,
      data: {
        runId: 'run-1',
        messages: [{ role: 'user', content: 'prior' }, { role: 'assistant', content: 'done' }]
      }
    })
    loadRunEvents.mockResolvedValue({ ok: true, data: [] })

    // @ts-expect-error test bridge
    window.vyotiq = {
      chatStart,
      chatCancel,
      listActiveRuns,
      loadRun,
      loadRunEvents,
      onChatEvent: (h: Handler) => {
        handler = h
        return () => {
          handler = null
        }
      }
    }

    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('active')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
    })

    await act(async () => {
      await result.current.stop()
    })

    await waitFor(() => {
      expect(result.current.running).toBe(false)
    })
    expect(loadRun).toHaveBeenCalledWith('/ws', 'run-1')
    expect(result.current.error).toBeNull()
    expect(result.current.items.some((i) => i.kind === 'message' && i.content === 'done')).toBe(true)
  })

  it('drops live tool rows and streamed text on stream_reset', async () => {
    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('retry me')
    })

    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({ type: 'text_delta', runId: 'run-1', text: 'doomed' })
      handler?.({
        type: 'tool_call_delta',
        runId: 'run-1',
        toolCallId: 'pending_0',
        name: 'read',
        argumentsDelta: '{"path":"a.ts"}'
      })
    })

    await waitFor(() => {
      expect(
        result.current.items.some((i) => i.kind === 'tool' && i.tool.status === 'running')
      ).toBe(true)
    })

    await act(async () => {
      handler?.({ type: 'stream_reset', runId: 'run-1', step: 1 })
    })

    expect(
      result.current.items.some((i) => i.kind === 'tool' && i.tool.status === 'running')
    ).toBe(false)
    const assistant = result.current.items.find(
      (i) => i.kind === 'message' && i.role === 'assistant'
    )
    if (assistant?.kind === 'message') {
      expect(assistant.content).toBe('')
      expect(assistant.streaming).toBe(false)
      expect(assistant.thinkingStreaming).toBe(false)
    }
  })

  it('clears approval only after respondToolApproval succeeds', async () => {
    const respondToolApproval = vi.fn().mockResolvedValue({ ok: true, data: true })
    // @ts-expect-error test bridge
    window.vyotiq.respondToolApproval = respondToolApproval

    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('edit')
    })
    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'edit',
        summary: 'a.ts'
      })
      result.current.handleApprovalRequest({
        requestId: 'req-1',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'edit',
        summary: 'a.ts',
        mutating: true
      })
    })

    expect(
      result.current.items.some((i) => i.kind === 'tool' && i.approval?.requestId === 'req-1')
    ).toBe(true)

    await act(async () => {
      await result.current.respondToApproval('req-1', 'once')
    })

    expect(respondToolApproval).toHaveBeenCalledWith('req-1', 'once')
    expect(result.current.items.some((i) => i.kind === 'tool' && i.approval)).toBe(false)
  })

  it('keeps approval visible when respondToolApproval fails', async () => {
    const respondToolApproval = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'approval expired' })
    // @ts-expect-error test bridge
    window.vyotiq.respondToolApproval = respondToolApproval

    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.send('edit')
    })
    await act(async () => {
      handler?.({ type: 'status', runId: 'run-1', status: 'running' })
      handler?.({
        type: 'tool_start',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'edit',
        summary: 'a.ts'
      })
      result.current.handleApprovalRequest({
        requestId: 'req-fail',
        runId: 'run-1',
        toolCallId: 'c1',
        name: 'edit',
        summary: 'a.ts',
        mutating: true
      })
    })

    await act(async () => {
      await expect(result.current.respondToApproval('req-fail', 'deny')).rejects.toThrow(
        /approval expired/
      )
    })

    expect(
      result.current.items.some((i) => i.kind === 'tool' && i.approval?.requestId === 'req-fail')
    ).toBe(true)
    expect(result.current.error).toBe('approval expired')
  })

  it('uses contentRunId for lazy tool loads after syncFromDisk clears runId', async () => {
    const loadToolResult = vi.fn().mockResolvedValue({
      ok: true,
      data: { content: 'full body' }
    })
    const loadRun = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        messages: [
          { role: 'user', content: 'read' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
          },
          { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'snip' }
        ]
      }
    })
    const loadRunEvents = vi.fn().mockResolvedValue({ ok: true, data: [] })
    // @ts-expect-error test bridge
    window.vyotiq.loadRun = loadRun
    // @ts-expect-error test bridge
    window.vyotiq.loadRunEvents = loadRunEvents
    // @ts-expect-error test bridge
    window.vyotiq.loadToolResult = loadToolResult

    const { result } = renderHook(() => useChatStream('/ws'))

    await act(async () => {
      await result.current.syncFromDisk('run-disk')
    })

    expect(result.current.runId).toBeNull()

    let content: string | null = null
    await act(async () => {
      content = await result.current.loadToolContent('c1')
    })

    expect(loadToolResult).toHaveBeenCalledWith('/ws', 'run-disk', 'c1')
    expect(content).toBe('full body')
  })
})
