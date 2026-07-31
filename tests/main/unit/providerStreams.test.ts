import { afterEach, describe, expect, it, vi } from 'vitest'
import { anthropicProvider } from '@main/agent/providers/anthropic'
import { openrouterProvider } from '@main/agent/providers/openai'
import { streamOpenAiResponses } from '@main/agent/providers/openaiResponses'
import { iterateSseData, iterateSseJson, STREAM_IDLE_TIMEOUT_MS } from '@main/agent/providers/sse'
import type { ProviderChatRequest, StreamChunk } from '@main/agent/providers/types'

function sseBody(frames: string[]): Response {
  return new Response(frames.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' }
  })
}

function chunkedResponse(chunks: string[]): { res: Response; cancelled: () => boolean } {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
    cancel() {
      cancelled = true
    }
  })
  return { res: new Response(stream), cancelled: () => cancelled }
}

function neverEndingResponse(chunks: string[]): { res: Response; cancelled: () => boolean } {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
    },
    cancel() {
      cancelled = true
    }
  })
  return { res: new Response(stream), cancelled: () => cancelled }
}

const baseReq = (partial: Partial<ProviderChatRequest> = {}): ProviderChatRequest => ({
  model: 'claude-sonnet-5',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  signal: new AbortController().signal,
  apiKey: 'test-key',
  ...partial
})

async function collect(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of gen) out.push(chunk)
  return out
}

describe('SSE frame parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reassembles frames split across read boundaries', async () => {
    const { res } = chunkedResponse(['data: {"a"', ':1}\n', '\ndata: {"b":2}\n\n'])
    const out: string[] = []
    for await (const data of iterateSseData(res, new AbortController().signal)) out.push(data)
    expect(out).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('joins multi-line data fields and skips comments and CRLF', async () => {
    const { res } = chunkedResponse([
      ': keepalive\r\n',
      'event: message\r\n',
      'data: line one\r\n',
      'data: line two\r\n',
      '\r\n',
      'data: [DONE]\r\n\r\n'
    ])
    const out: string[] = []
    for await (const data of iterateSseData(res, new AbortController().signal)) out.push(data)
    expect(out).toEqual(['line one\nline two'])
  })

  it('counts malformed JSON frames instead of failing the stream', async () => {
    const { res } = chunkedResponse(['data: not json\n\n', 'data: {"ok":true}\n\n'])
    const drops = { dropped: 0 }
    const out: Record<string, unknown>[] = []
    for await (const ev of iterateSseJson(res, new AbortController().signal, drops)) out.push(ev)
    expect(out).toEqual([{ ok: true }])
    expect(drops.dropped).toBe(1)
  })

  it('cancels the response body when the consumer stops reading early', async () => {
    const { res, cancelled } = neverEndingResponse(['data: {"a":1}\n\n', 'data: {"b":2}\n\n'])
    for await (const _data of iterateSseData(res, new AbortController().signal)) {
      break
    }
    expect(cancelled()).toBe(true)
  })

  it('throws StreamIdleTimeoutError when no bytes arrive within the idle window', async () => {
    vi.useFakeTimers()
    const { res, cancelled } = neverEndingResponse([])
    const pending = iterateSseData(res, new AbortController().signal, {
      idleTimeoutMs: 1_000
    }).next()
    const expectation = expect(pending).rejects.toMatchObject({
      name: 'StreamIdleTimeoutError',
      idleMs: 1_000
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await expectation
    expect(cancelled()).toBe(true)
  })

  it('resets the idle timer when SSE keep-alive comments arrive', async () => {
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const res = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
        }
      })
    )
    const pending = iterateSseData(res, new AbortController().signal, {
      idleTimeoutMs: 5_000
    }).next()

    await vi.advanceTimersByTimeAsync(4_000)
    controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(4_000)
    controller.enqueue(encoder.encode('data: hello\n\n'))
    controller.close()

    await expect(pending).resolves.toEqual({ done: false, value: 'hello' })
  })

  it('exposes the default idle threshold at 10 minutes', () => {
    expect(STREAM_IDLE_TIMEOUT_MS).toBe(10 * 60 * 1000)
  })
})

describe('anthropic stream usage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('counts cache reads and cache writes as part of the prompt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'event: message_start\n',
          'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":1200,"cache_read_input_tokens":900,"cache_creation_input_tokens":10,"output_tokens":1}}}\n\n',
          'event: content_block_start\n',
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'event: content_block_delta\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
          'event: message_delta\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}\n\n',
          'event: message_stop\n',
          'data: {"type":"message_stop"}\n\n'
        ])
      )
    )

    const chunks = await collect(anthropicProvider.streamChat(baseReq()))
    const done = chunks.find((c) => c.type === 'done')

    expect(done?.stopReason).toBe('stop')
    // Anthropic reports cache reads/writes outside `input_tokens`; the prompt the
    // model actually saw is the sum, which is what the context meter needs.
    expect(done?.usage).toEqual({
      inputTokens: 2110,
      outputTokens: 42,
      cachedInputTokens: 900,
      reasoningTokens: undefined,
      totalTokens: 2152
    })
  })

  it('keeps message_start input tokens when message_delta only reports output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":50,"output_tokens":0}}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":7}}\n\n'
        ])
      )
    )

    const chunks = await collect(anthropicProvider.streamChat(baseReq()))
    const done = chunks.find((c) => c.type === 'done')

    expect(done?.usage?.inputTokens).toBe(50)
    expect(done?.usage?.outputTokens).toBe(7)
    expect(done?.stopReason).toBe('length')
  })
})

describe('openai responses stream', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('surfaces the provider error message when the response fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'data: {"type":"response.created","response":{"id":"resp_1"}}\n\n',
          'data: {"type":"response.failed","response":{"id":"resp_1","status":"failed","error":{"code":"server_error","message":"The model produced invalid content."}}}\n\n'
        ])
      )
    )

    const chunks = await collect(streamOpenAiResponses(baseReq({ model: 'gpt-5' })))
    const error = chunks.find((c) => c.type === 'error')

    expect(error?.error).toContain('The model produced invalid content.')
  })

  it('streams tool call argument deltas keyed by item_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read"}}\n\n',
          'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{\\"path\\":"}\n\n',
          'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"\\"a.ts\\"}"}\n\n',
          'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read","arguments":"{\\"path\\":\\"a.ts\\"}"}}\n\n',
          'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":10,"output_tokens":5}}}\n\n'
        ])
      )
    )

    const chunks = await collect(streamOpenAiResponses(baseReq({ model: 'gpt-5' })))
    const deltas = chunks.filter((c) => c.type === 'tool_call_delta')

    expect(deltas[0]?.toolCallDelta).toMatchObject({
      id: 'call_1',
      name: 'read',
      arguments: ''
    })
    expect(deltas.map((d) => d.toolCallDelta?.arguments).join('')).toBe('{"path":"a.ts"}')
    expect(deltas.every((d) => d.toolCallDelta?.id === 'call_1')).toBe(true)
    expect(chunks.filter((c) => c.type === 'tool_call')).toHaveLength(1)
  })

  it('emits thinking_done before answer text when reasoning precedes content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'data: {"choices":[{"delta":{"reasoning_content":"Let me greet."}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"choices":[{"finish_reason":"stop"}]}\n\n'
        ])
      )
    )

    const chunks = await collect(
      openrouterProvider.streamChat(baseReq({ model: 'deepseek/deepseek-v3' }))
    )
    const types = chunks.map((c) => c.type)

    expect(types.indexOf('thinking_done')).toBeLessThan(types.indexOf('text'))
    expect(chunks.filter((c) => c.type === 'thinking_done')).toHaveLength(1)
  })
})

describe('anthropic thinking block boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits thinking_done when a thinking block closes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Plan first."}}\n\n',
          'data: {"type":"content_block_stop","index":0}\n\n',
          'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
          'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'
        ])
      )
    )

    const chunks = await collect(anthropicProvider.streamChat(baseReq()))
    const types = chunks.map((c) => c.type)

    expect(types.indexOf('thinking_done')).toBeLessThan(types.indexOf('text'))
    expect(chunks.find((c) => c.type === 'thinking_done')?.text).toBe('Plan first.')
  })

  it('emits tool_call_delta when a tool_use block starts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read"}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a.ts\\"}"}}\n\n',
          'data: {"type":"content_block_stop","index":0}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n'
        ])
      )
    )

    const chunks = await collect(anthropicProvider.streamChat(baseReq()))
    const deltas = chunks.filter((c) => c.type === 'tool_call_delta')

    expect(deltas[0]?.toolCallDelta).toMatchObject({
      id: 'toolu_1',
      name: 'read',
      arguments: ''
    })
    expect(deltas[1]?.toolCallDelta?.arguments).toBe('{"path":"a.ts"}')
  })
})

describe('openai compat tool-before-text ordering', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('yields tool_call_delta before text when both arrive in the same SSE frame', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'data: {"choices":[{"delta":{"content":"Looking up.","tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n'
        ])
      )
    )

    const chunks = await collect(
      openrouterProvider.streamChat(baseReq({ model: 'deepseek/deepseek-v3' }))
    )
    const types = chunks.map((c) => c.type)
    const toolIdx = types.indexOf('tool_call_delta')
    const textIdx = types.indexOf('text')

    expect(toolIdx).toBeGreaterThanOrEqual(0)
    expect(textIdx).toBeGreaterThan(toolIdx)
  })
})

describe('gemini mid-stream tool_call', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('yields tool_call when a functionCall part appears mid-stream', async () => {
    const { geminiProvider } = await import('@main/agent/providers/gemini')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'data: {"candidates":[{"content":{"parts":[{"text":"Checking."}]}}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read","args":{"path":"a.ts"},"id":"g1"}}]}}]}\n\n',
          'data: {"candidates":[{"finishReason":"STOP"}]}\n\n'
        ])
      )
    )

    const chunks = await collect(
      geminiProvider.streamChat(
        baseReq({ model: 'gemini-2.0-flash', apiKey: 'test-key', tools: [] })
      )
    )
    const midStreamCalls = chunks.filter((c) => c.type === 'tool_call')
    const textIdx = chunks.findIndex((c) => c.type === 'text')
    const firstCallIdx = chunks.findIndex((c) => c.type === 'tool_call')

    expect(midStreamCalls).toHaveLength(1)
    expect(firstCallIdx).toBeGreaterThan(textIdx)
    expect(midStreamCalls[0]?.toolCall).toMatchObject({
      id: 'g1',
      name: 'read',
      arguments: '{"path":"a.ts"}'
    })
  })
})

describe('openai responses thinking boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('emits thinking_done before output text when reasoning streams first', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseBody([
          'data: {"type":"response.reasoning_summary_text.delta","delta":"Reasoning."}\n\n',
          'data: {"type":"response.output_text.delta","delta":"Answer."}\n\n',
          'data: {"type":"response.completed","response":{"id":"resp_1"}}\n\n'
        ])
      )
    )

    const chunks = await collect(streamOpenAiResponses(baseReq({ model: 'gpt-5' })))
    const types = chunks.map((c) => c.type)

    expect(types.indexOf('thinking_done')).toBeLessThan(types.indexOf('text'))
    expect(chunks.filter((c) => c.type === 'thinking_done')).toHaveLength(1)
  })
})
