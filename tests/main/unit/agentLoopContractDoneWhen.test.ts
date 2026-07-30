import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { StreamChunk } from '@main/agent/providers/types'
import { resolveRunDir } from '@main/storage/paths'
import { DEFAULT_SETTINGS } from '@shared/ipc'
import { RUN_RECEIPT_FILENAME } from '@main/agent/runReceipt'

const userData = join(tmpdir(), `vyotiq-cdw-loop-${process.pid}-${Date.now()}`)

const getSettings = vi.fn(() => ({
  ...DEFAULT_SETTINGS,
  verifyBeforeDone: 'off' as const,
  contractDoneWhen: 'require' as const,
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

function writeCheckableContract(workspace: string, runId: string, body: string): void {
  const runDir = resolveRunDir(workspace, runId)
  writeFileSync(
    join(runDir, 'contract.md'),
    ['## Goal', '', 'Test', '', '## Done when', '', body, ''].join('\n'),
    'utf8'
  )
}

describe('runAgent contractDoneWhen', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-cdw-ws-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    resetActiveRunsForTests()
    streamChat.mockReset()
    executeTool.mockReset()
    toolDiagnosticsAsync.mockReset()
    getSettings.mockClear()
    getSettings.mockImplementation(() => ({
      ...DEFAULT_SETTINGS,
      verifyBeforeDone: 'off' as const,
      contractDoneWhen: 'require' as const,
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

  it('require mode nudges while a required file is missing, then finishes when present', async () => {
    const runId = 'cdw-require-file'
    let call = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      call += 1
      if (call === 1) {
        writeCheckableContract(workspace, runId, '- Deliverable `deliverable.ts` exists')
        yield { type: 'text', text: 'Done without file.' }
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      if (call === 2) {
        writeFileSync(join(workspace, 'deliverable.ts'), 'export {}\n')
        yield { type: 'text', text: 'Created file; finishing.' }
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      yield { type: 'text', text: 'Done.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })

    for await (const _ev of runAgent({
      runId,
      messages: [{ role: 'user', content: 'ship' }],
      workspacePath: workspace,
      mode: 'agent'
    })) {
      // drain
    }

    expect(call).toBe(2)
    const receipt = JSON.parse(
      readFileSync(join(resolveRunDir(workspace, runId), RUN_RECEIPT_FILENAME), 'utf8')
    ) as {
      contractDoneWhen: {
        mode: string
        nudged: boolean
        checkableCriteria: number
        unmetCriteria?: string[]
      }
      status: string
    }
    expect(receipt.status).toBe('done')
    expect(receipt.contractDoneWhen.mode).toBe('require')
    expect(receipt.contractDoneWhen.nudged).toBe(true)
    expect(receipt.contractDoneWhen.checkableCriteria).toBeGreaterThanOrEqual(1)
  })

  it('notice mode allows finish after one nudge', async () => {
    getSettings.mockImplementation(() => ({
      ...DEFAULT_SETTINGS,
      verifyBeforeDone: 'off' as const,
      contractDoneWhen: 'notice' as const,
      provider: 'ollama' as const,
      model: 'qwen2.5',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      theme: 'system' as const,
      telemetryEnabled: false
    }))

    const runId = 'cdw-notice'
    let call = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      call += 1
      writeCheckableContract(workspace, runId, '- Need `never.ts`')
      yield { type: 'text', text: `Attempt ${call}` }
      yield { type: 'done', stopReason: 'end_turn' }
    })

    for await (const _ev of runAgent({
      runId,
      messages: [{ role: 'user', content: 'go' }],
      workspacePath: workspace,
      mode: 'agent'
    })) {
      // drain
    }

    expect(call).toBe(2)
    const receipt = JSON.parse(
      readFileSync(join(resolveRunDir(workspace, runId), RUN_RECEIPT_FILENAME), 'utf8')
    ) as { contractDoneWhen: { mode: string; nudged: boolean }; status: string }
    expect(receipt.status).toBe('done')
    expect(receipt.contractDoneWhen.mode).toBe('notice')
    expect(receipt.contractDoneWhen.nudged).toBe(true)
  })

  it('skips gate when Done-when has no checkable bullets', async () => {
    const runId = 'cdw-subjective'
    let call = 0
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      call += 1
      // Override default contract (which includes checkable Typecheck) with advisory-only bullets.
      writeCheckableContract(
        workspace,
        runId,
        '- The goal above is satisfied\n- Or blockers are explained clearly'
      )
      yield { type: 'text', text: 'Done.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })

    for await (const _ev of runAgent({
      runId,
      messages: [{ role: 'user', content: 'chat' }],
      workspacePath: workspace,
      mode: 'agent'
    })) {
      // drain
    }

    expect(call).toBe(1)
    const receipt = JSON.parse(
      readFileSync(join(resolveRunDir(workspace, runId), RUN_RECEIPT_FILENAME), 'utf8')
    ) as { contractDoneWhen: { nudged: boolean; checkableCriteria: number } }
    expect(receipt.contractDoneWhen.nudged).toBe(false)
    expect(receipt.contractDoneWhen.checkableCriteria).toBe(0)
  })
})
