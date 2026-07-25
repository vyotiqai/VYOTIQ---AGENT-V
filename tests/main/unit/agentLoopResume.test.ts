import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { StreamChunk } from '@main/agent/providers/types'

const userData = join(tmpdir(), `vyotiq-resume-${process.pid}-${Date.now()}`)

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
    maxSteps: 25,
    theme: 'system',
    telemetryEnabled: false
  }),
  readLegacyWorkspacePath: () => null
}))

vi.mock('@main/settings/secrets', () => ({
  getSecret: () => null
}))

vi.mock('@main/agent/harness', () => ({
  loadHarness: () => 'harness'
}))

const assembleContextMock = vi.fn(async (input: {
  messages: unknown[]
  priorCompaction?: unknown
}) => ({
  messages: input.messages,
  system: 'system',
  estimatedTokens: 100,
  layers: { system: 10, history: 50, tools: 20, buffer: 20 },
  contextShrunk: false,
  anthropicNative: undefined,
  compaction: null
}))

vi.mock('@main/agent/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/context')>()
  return {
    ...actual,
    assembleContext: (input: Parameters<typeof assembleContextMock>[0]) => assembleContextMock(input),
    ensureMemoryLayout: () => undefined
  }
})

const streamChat = vi.fn()

vi.mock('@main/agent/providers', () => ({
  getProvider: () => ({
    id: 'ollama',
    listModels: async () => [],
    streamChat
  }),
  listProviderModels: async () => ({
    models: [
      {
        id: 'qwen2.5',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsTools: false,
        supportsVision: false
      }
    ]
  })
}))

import { runAgent } from '@main/agent/loop'
import { isActive, registerRunAbort, resetActiveRunsForTests } from '@main/agent/runRegistry'
import { createRun, loadCompaction, loadMessages, saveCompaction } from '@main/agent/state'

describe('runAgent session continuation', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-resume-ws-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    resetActiveRunsForTests()
    streamChat.mockReset()
    assembleContextMock.mockClear()
  })

  afterEach(() => {
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
  })

  it('clears active state after a turn completes', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'hello' }
    })

    const runId = 'session-run'
    for await (const _ev of runAgent({
      runId,
      messages: [{ role: 'user', content: 'hi' }],
      workspacePath: workspace
    })) {
      // drain
    }

    expect(isActive(runId)).toBe(false)
  })

  it('resumes the same runId after the previous turn completes', async () => {
    const runId = 'session-run'

    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'hello' }
    })

    for await (const _ev of runAgent({
      runId,
      messages: [{ role: 'user', content: 'hi' }],
      workspacePath: workspace
    })) {
      // drain
    }

    expect(isActive(runId)).toBe(false)

    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'file list' }
    })

    // chatStart pre-registers before runAgent (startup cancel race).
    registerRunAbort(runId, workspace)

    const events: Array<{ type: string; status?: string; code?: string; message?: string }> = []
    for await (const ev of runAgent({
      runId,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'list all the files' }
      ],
      workspacePath: workspace,
      resume: true
    })) {
      events.push(ev)
    }

    expect(events.some((e) => e.type === 'error' && e.code === 'RUN_ACTIVE')).toBe(false)
    expect(events.some((e) => e.type === 'status' && e.status === 'done')).toBe(true)
    expect(isActive(runId)).toBe(false)

    const messages = loadMessages(workspace, runId)
    expect(messages).toHaveLength(4)
    expect(messages[2]).toMatchObject({ role: 'user', content: 'list all the files' })
    expect(messages[3]).toMatchObject({ role: 'assistant', content: 'file list' })
  })

  it('loads persisted compaction when resuming a run', async () => {
    const runId = 'compact-resume'
    const runDir = createRun(workspace, runId, 'goal')
    const record = {
      summary: '## Session Intent\nPrior work summary',
      createdAt: new Date().toISOString(),
      tokenEstimate: 120
    }
    saveCompaction(runDir, record)

    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'ok' }
    })

    for await (const _ev of runAgent({
      runId,
      messages: [{ role: 'user', content: 'continue' }],
      workspacePath: workspace
    })) {
      // drain
    }

    expect(loadCompaction(runDir)).toEqual(record)
    expect(assembleContextMock).toHaveBeenCalled()
    const input = assembleContextMock.mock.calls[0]?.[0] as { priorCompaction?: unknown }
    expect(input.priorCompaction).toEqual(record)
  })
})
