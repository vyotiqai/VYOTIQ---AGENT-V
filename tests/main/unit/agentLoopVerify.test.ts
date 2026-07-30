import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { StreamChunk } from '@main/agent/providers/types'
import { resolveRunDir } from '@main/storage/paths'
import { DEFAULT_SETTINGS } from '@shared/ipc'
import { RUN_RECEIPT_FILENAME } from '@main/agent/runReceipt'

const userData = join(tmpdir(), `vyotiq-verify-${process.pid}-${Date.now()}`)

const getSettings = vi.fn(() => ({
  ...DEFAULT_SETTINGS,
  verifyBeforeDone: 'notice' as const,
  provider: 'ollama' as const,
  model: 'qwen2.5',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  theme: 'system' as const,
  telemetryEnabled: false
}))

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
  getSettings: () => getSettings(),
  readLegacyWorkspacePath: () => null
}))

vi.mock('@main/settings/secrets', () => ({
  getSecret: () => null
}))

vi.mock('@main/agent/harness', () => ({
  loadHarness: () => 'harness'
}))

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

const { streamChat, executeTool, toolDiagnosticsAsync } = vi.hoisted(() => ({
  streamChat: vi.fn(),
  executeTool: vi.fn(),
  toolDiagnosticsAsync: vi.fn()
}))

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
        label: 'qwen2.5',
        contextWindow: 32_000,
        supportsTools: true,
        supportsThinking: false
      }
    ]
  })
}))

vi.mock('@main/agent/tools', () => ({
  executeTool: (...args: unknown[]) => executeTool(...args)
}))

vi.mock('@main/agent/tools/diagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/tools/diagnostics')>()
  return {
    ...actual,
    toolDiagnosticsAsync: (...args: unknown[]) => toolDiagnosticsAsync(...args)
  }
})

import { runAgent } from '@main/agent/loop'
import { resetActiveRunsForTests } from '@main/agent/runRegistry'

describe('runAgent verify-before-done + receipt', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-verify-ws-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    resetActiveRunsForTests()
    streamChat.mockReset()
    executeTool.mockReset()
    toolDiagnosticsAsync.mockReset()
    getSettings.mockClear()
    getSettings.mockImplementation(() => ({
      ...DEFAULT_SETTINGS,
      verifyBeforeDone: 'notice' as const,
      provider: 'ollama' as const,
      model: 'qwen2.5',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      theme: 'system' as const,
      telemetryEnabled: false
    }))
  })

  afterEach(() => {
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
  })

  it('nudges once on notice then finishes; writes receipt.json', async () => {
    let call = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      call += 1
      if (call === 1) {
        yield { type: 'text', text: 'Finished without tools.' }
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      yield { type: 'text', text: 'Verified; done now.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })

    const runId = 'verify-notice'
    const events: Array<{ type: string; status?: string }> = []
    for await (const ev of runAgent({
      runId,
      messages: [{ role: 'user', content: 'do work' }],
      workspacePath: workspace,
      mode: 'agent'
    })) {
      events.push(ev)
    }

    expect(call).toBe(2)
    expect(events.some((e) => e.type === 'status' && e.status === 'done')).toBe(true)

    const runDir = resolveRunDir(workspace, runId)
    const receiptPath = join(runDir, RUN_RECEIPT_FILENAME)
    expect(existsSync(receiptPath)).toBe(true)
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      verifyBeforeDone: { mode: string; nudged: boolean }
      status: string
    }
    expect(receipt.status).toBe('done')
    expect(receipt.verifyBeforeDone.mode).toBe('notice')
    expect(receipt.verifyBeforeDone.nudged).toBe(true)
  })

  it('skips nudge when diagnostics evidence already exists', async () => {
    let call = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      call += 1
      if (call === 1) {
        yield {
          type: 'tool_call',
          toolCall: { id: 'd1', name: 'diagnostics', arguments: '{"kind":"typecheck"}' }
        }
        yield { type: 'done', stopReason: 'tool_calls' }
        return
      }
      yield { type: 'text', text: 'Typecheck clean.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })
    executeTool.mockResolvedValue({ ok: true, summary: 'diag', content: 'command: tsc\n\nok' })

    const events: Array<{ type: string; status?: string }> = []
    for await (const ev of runAgent({
      runId: 'verify-with-diag',
      messages: [{ role: 'user', content: 'check' }],
      workspacePath: workspace,
      mode: 'agent'
    })) {
      events.push(ev)
    }

    expect(call).toBe(2)
    expect(events.some((e) => e.type === 'status' && e.status === 'done')).toBe(true)
    const receipt = JSON.parse(
      readFileSync(join(resolveRunDir(workspace, 'verify-with-diag'), RUN_RECEIPT_FILENAME), 'utf8')
    ) as { verifyBeforeDone: { nudged: boolean }; diagnostics: { calls: number } }
    expect(receipt.verifyBeforeDone.nudged).toBe(false)
    expect(receipt.diagnostics.calls).toBe(1)
  })

  it('require mode skips nudge when external typecheck is clean', async () => {
    getSettings.mockImplementation(() => ({
      ...DEFAULT_SETTINGS,
      verifyBeforeDone: 'require' as const,
      provider: 'ollama' as const,
      model: 'qwen2.5',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      theme: 'system' as const,
      telemetryEnabled: false
    }))
    toolDiagnosticsAsync.mockResolvedValue({ ok: true, content: 'command: tsc\n\nok' })

    let call = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      call += 1
      yield { type: 'text', text: 'Done.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })

    for await (const _ev of runAgent({
      runId: 'verify-require-clean',
      messages: [{ role: 'user', content: 'do' }],
      workspacePath: workspace,
      mode: 'agent'
    })) {
      // drain
    }

    expect(call).toBe(1)
    expect(toolDiagnosticsAsync).toHaveBeenCalled()
    const receipt = JSON.parse(
      readFileSync(
        join(resolveRunDir(workspace, 'verify-require-clean'), RUN_RECEIPT_FILENAME),
        'utf8'
      )
    ) as { verifyBeforeDone: { nudged: boolean; mode: string } }
    expect(receipt.verifyBeforeDone.mode).toBe('require')
    expect(receipt.verifyBeforeDone.nudged).toBe(false)
  })

  it('require mode nudges once when external typecheck is dirty', async () => {
    getSettings.mockImplementation(() => ({
      ...DEFAULT_SETTINGS,
      verifyBeforeDone: 'require' as const,
      provider: 'ollama' as const,
      model: 'qwen2.5',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      theme: 'system' as const,
      telemetryEnabled: false
    }))
    toolDiagnosticsAsync.mockResolvedValue({
      ok: false,
      content: 'a.ts(1,1): error TS2322: Type bad'
    })

    let call = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      call += 1
      if (call === 1) {
        yield { type: 'text', text: 'Finished.' }
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      yield { type: 'text', text: 'Fixed after verify.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })

    for await (const _ev of runAgent({
      runId: 'verify-require-dirty',
      messages: [{ role: 'user', content: 'do' }],
      workspacePath: workspace,
      mode: 'agent'
    })) {
      // drain
    }

    expect(call).toBe(2)
    expect(toolDiagnosticsAsync).toHaveBeenCalled()
    const receipt = JSON.parse(
      readFileSync(
        join(resolveRunDir(workspace, 'verify-require-dirty'), RUN_RECEIPT_FILENAME),
        'utf8'
      )
    ) as { verifyBeforeDone: { nudged: boolean } }
    expect(receipt.verifyBeforeDone.nudged).toBe(true)
  })

  it('records wroteFiles from a real edit checkpoint', async () => {
    getSettings.mockImplementation(() => ({
      ...DEFAULT_SETTINGS,
      verifyBeforeDone: 'off' as const,
      provider: 'ollama' as const,
      model: 'qwen2.5',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      theme: 'system' as const,
      telemetryEnabled: false
    }))

    const tools = await vi.importActual<typeof import('@main/agent/tools')>('@main/agent/tools')
    executeTool.mockImplementation((...args: unknown[]) =>
      tools.executeTool(...(args as Parameters<typeof tools.executeTool>))
    )

    let call = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      call += 1
      if (call === 1) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'e1',
            name: 'edit',
            arguments: JSON.stringify({ path: 'hello.ts', contents: 'export const x = 1\n' })
          }
        }
        yield { type: 'done', stopReason: 'tool_calls' }
        return
      }
      yield { type: 'text', text: 'Wrote hello.ts' }
      yield { type: 'done', stopReason: 'end_turn' }
    })

    for await (const _ev of runAgent({
      runId: 'verify-wrote',
      messages: [{ role: 'user', content: 'write' }],
      workspacePath: workspace,
      mode: 'agent'
    })) {
      // drain
    }

    const receipt = JSON.parse(
      readFileSync(join(resolveRunDir(workspace, 'verify-wrote'), RUN_RECEIPT_FILENAME), 'utf8')
    ) as { wroteFiles: string[] }
    expect(receipt.wroteFiles).toContain('hello.ts')
  })
})
