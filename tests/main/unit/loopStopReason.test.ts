import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { StreamChunk } from '@main/agent/providers/types'
import { resolveRunDir } from '@main/storage/paths'

const userData = join(tmpdir(), `vyotiq-stopreason-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userData
      throw new Error(`unexpected getPath(${name})`)
    },
    getAppPath: () => '/tmp/vyotiq-app',
    isPackaged: false
  }
}))

vi.mock('@main/agent/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/mcp')>()
  return {
    ...actual,
    syncMcpServers: vi.fn(async () => {}),
    listMcpToolDefinitions: () => []
  }
})

vi.mock('@main/settings/settings', () => ({
  getSettings: () => ({
    provider: 'ollama',
    model: 'qwen2.5',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    maxSteps: 4,
    theme: 'system',
    telemetryEnabled: false
  }),
  readLegacyWorkspacePath: () => null
}))

vi.mock('@main/settings/secrets', () => ({ getSecret: () => null }))
vi.mock('@main/agent/harness', () => ({ loadHarness: () => 'harness' }))

vi.mock('@main/agent/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/context')>()
  return {
    ...actual,
    assembleContext: async (input: { messages: unknown[] }) => ({
      messages: input.messages,
      system: 'system',
      estimatedTokens: 100,
      layers: { system: 10, history: 50, tools: 20, buffer: 20 },
      contextShrunk: false,
      anthropicNative: undefined,
      compaction: null
    }),
    ensureMemoryLayout: () => undefined
  }
})

const { streamChat, executeTool } = vi.hoisted(() => ({
  streamChat: vi.fn(),
  executeTool: vi.fn()
}))

vi.mock('@main/agent/providers', () => ({
  getProvider: () => ({ id: 'ollama', listModels: async () => [], streamChat }),
  listProviderModels: async () => ({
    models: [
      {
        id: 'qwen2.5',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsTools: true,
        supportsVision: false
      }
    ]
  })
}))

vi.mock('@main/agent/tools', () => ({
  executeTool: (...args: unknown[]) => executeTool(...args)
}))

import { runAgent } from '@main/agent/loop'
import { resetActiveRunsForTests } from '@main/agent/runRegistry'

type CapturedEvent = {
  type: string
  status?: string
  reason?: string
  content?: string
  code?: string
  message?: string
}

async function collect(runId: string, workspace: string): Promise<CapturedEvent[]> {
  const events: CapturedEvent[] = []
  for await (const ev of runAgent({
    runId,
    messages: [{ role: 'user', content: 'do the thing' }],
    workspacePath: workspace
  })) {
    events.push(ev as CapturedEvent)
  }
  return events
}

describe('runAgent stop-reason classification', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-stopreason-ws-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    resetActiveRunsForTests()
    streamChat.mockReset()
    executeTool.mockReset()
  })

  afterEach(() => {
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
  })

  it('reports truncation when the provider stops on the output token limit', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'half an ans' }
      yield { type: 'done', stopReason: 'length' }
    })

    const events = await collect('stop-truncated', workspace)
    const incomplete = events.find((e) => e.type === 'incomplete')

    expect(incomplete?.reason).toBe('truncated')
    expect(events.some((e) => e.type === 'status' && e.status === 'done')).toBe(true)
  })

  it('reports an empty response when the model returns nothing at all', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'done', stopReason: 'stop' }
    })

    const events = await collect('stop-empty', workspace)

    expect(events.find((e) => e.type === 'incomplete')?.reason).toBe('empty_response')
  })

  it('reports a content filter stop', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'partial' }
      yield { type: 'done', stopReason: 'content_filter' }
    })

    const events = await collect('stop-filtered', workspace)

    expect(events.find((e) => e.type === 'incomplete')?.reason).toBe('filtered')
  })

  it('stays silent when the model finishes cleanly', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'all done' }
      yield { type: 'done', stopReason: 'stop' }
    })

    const events = await collect('stop-clean', workspace)

    expect(events.some((e) => e.type === 'incomplete')).toBe(false)
    expect(events.some((e) => e.type === 'status' && e.status === 'done')).toBe(true)
  })

  it('reports truncation when stopReason is tool_calls but no tools were parsed', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'about to call' }
      yield { type: 'done', stopReason: 'tool_calls' }
    })

    const events = await collect('stop-tool-parse-fail', workspace)

    expect(events.find((e) => e.type === 'incomplete')?.reason).toBe('truncated')
  })

  it('reports truncation when a provider error arrives after partial text', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'partial answer' }
      yield { type: 'done', stopReason: 'error' }
    })

    const events = await collect('stop-error-partial', workspace)

    expect(events.find((e) => e.type === 'incomplete')?.reason).toBe('truncated')
  })

  it('treats a missing stop reason with real text as a clean finish', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'answer' }
      yield { type: 'done' }
    })

    const events = await collect('stop-unset', workspace)

    expect(events.some((e) => e.type === 'incomplete')).toBe(false)
  })

  it('flags max_steps when the budget runs out mid-work', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield {
        type: 'tool_call',
        toolCall: { id: `c${Math.random()}`, name: 'read', arguments: '{"path":"a.ts"}' }
      }
      yield { type: 'done', stopReason: 'tool_calls' }
    })
    executeTool.mockResolvedValue({ ok: true, summary: 'file', content: 'body' })

    const events = await collect('stop-max-steps', workspace)

    expect(events.find((e) => e.type === 'incomplete')?.reason).toBe('max_steps')
  })
})

describe('runAgent partial persistence', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-partial-ws-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    resetActiveRunsForTests()
    streamChat.mockReset()
    executeTool.mockReset()
  })

  afterEach(() => {
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
  })

  it('keeps text that streamed before a non-retriable provider error', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'streamed before the failure' }
      yield { type: 'error', error: 'HTTP 400: bad request' }
    })

    const runId = 'partial-on-error'
    const events = await collect(runId, workspace)

    expect(events.some((e) => e.type === 'error' && e.code === 'PROVIDER_STREAM')).toBe(true)

    const messages = readFileSync(join(resolveRunDir(workspace, runId), 'messages.jsonl'), 'utf8')
    expect(messages).toContain('streamed before the failure')
  })

  it('emits stream_reset so the UI drops output from a retried attempt', async () => {
    let attempt = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      attempt += 1
      if (attempt === 1) {
        yield { type: 'text', text: 'doomed first attempt' }
        yield { type: 'error', error: 'socket hang up' }
        return
      }
      yield { type: 'text', text: 'good second attempt' }
      yield { type: 'done', stopReason: 'stop' }
    })

    const events = await collect('partial-retry', workspace)

    expect(events.some((e) => e.type === 'stream_reset')).toBe(true)
    expect(events.some((e) => e.type === 'status' && e.status === 'done')).toBe(true)
  })

  it('emits stream_reset when the failed attempt only streamed tool deltas', async () => {
    let attempt = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      attempt += 1
      if (attempt === 1) {
        yield {
          type: 'tool_call_delta',
          toolCallDelta: {
            index: 0,
            id: 'call_1',
            name: 'read',
            arguments: '{"path":'
          }
        }
        yield { type: 'error', error: 'socket hang up' }
        return
      }
      yield { type: 'text', text: 'recovered' }
      yield { type: 'done', stopReason: 'stop' }
    })

    const events = await collect('tool-delta-retry', workspace)

    expect(events.some((e) => e.type === 'stream_reset')).toBe(true)
    expect(events.some((e) => e.type === 'status' && e.status === 'done')).toBe(true)
  })
})
