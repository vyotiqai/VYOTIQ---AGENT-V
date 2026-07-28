import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ChatEventBatcher } from '@main/ipc/streamBatch'
import type { AgentEvent } from '@shared/ipc'

describe('ChatEventBatcher', () => {
  let sent: AgentEvent[]

  beforeEach(() => {
    sent = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves interleaved thinking and text order within a batch window', () => {
    const batcher = new ChatEventBatcher((ev) => sent.push(ev))

    batcher.push({ type: 'thinking_delta', runId: 'run-1', text: 'reason ' })
    batcher.push({ type: 'text_delta', runId: 'run-1', text: 'answer' })
    batcher.push({ type: 'thinking_delta', runId: 'run-1', text: 'more' })

    vi.advanceTimersByTime(16)

    expect(sent.map((ev) => ev.type)).toEqual([
      'thinking_delta',
      'text_delta',
      'thinking_delta'
    ])
    expect(sent[0]).toMatchObject({ type: 'thinking_delta', text: 'reason ' })
    expect(sent[1]).toMatchObject({ type: 'text_delta', text: 'answer' })
    expect(sent[2]).toMatchObject({ type: 'thinking_delta', text: 'more' })
  })

  it('coalesces consecutive segments of the same kind', () => {
    const batcher = new ChatEventBatcher((ev) => sent.push(ev))

    batcher.push({ type: 'text_delta', runId: 'run-1', text: 'hel' })
    batcher.push({ type: 'text_delta', runId: 'run-1', text: 'lo' })

    vi.advanceTimersByTime(16)

    expect(sent).toEqual([{ type: 'text_delta', runId: 'run-1', text: 'hello' }])
  })

  it('flushes pending deltas before non-delta events', () => {
    const batcher = new ChatEventBatcher((ev) => sent.push(ev))

    batcher.push({ type: 'thinking_delta', runId: 'run-1', text: 'think' })
    batcher.push({ type: 'status', runId: 'run-1', status: 'done' })

    expect(sent.map((ev) => ev.type)).toEqual(['thinking_delta', 'status'])
  })

  it('preserves invoke ids on batched deltas and keeps thinking steps separate', () => {
    const batcher = new ChatEventBatcher((ev) => sent.push(ev))

    batcher.push({
      type: 'thinking_delta',
      runId: 'run-1',
      invokeId: 7,
      step: 1,
      text: 'first'
    })
    batcher.push({
      type: 'thinking_delta',
      runId: 'run-1',
      invokeId: 7,
      step: 2,
      text: 'second'
    })
    batcher.push({ type: 'text_delta', runId: 'run-1', invokeId: 7, text: 'answer' })

    vi.advanceTimersByTime(16)

    expect(sent).toEqual([
      { type: 'thinking_delta', runId: 'run-1', invokeId: 7, step: 1, text: 'first' },
      { type: 'thinking_delta', runId: 'run-1', invokeId: 7, step: 2, text: 'second' },
      { type: 'text_delta', runId: 'run-1', invokeId: 7, text: 'answer' }
    ])
  })
})
