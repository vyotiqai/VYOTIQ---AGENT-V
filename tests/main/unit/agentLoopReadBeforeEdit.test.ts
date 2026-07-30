import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { StreamChunk } from '@main/agent/providers/types'
import { resolveRunDir } from '@main/storage/paths'
import { DEFAULT_SETTINGS } from '@shared/ipc'
import { RUN_RECEIPT_FILENAME } from '@main/agent/runReceipt'

const userData = join(tmpdir(), `vyotiq-rbe-loop-${process.pid}-${Date.now()}`)

const getSettings = vi.fn(() => ({
  ...DEFAULT_SETTINGS,
  verifyBeforeDone: 'off' as const,
  contractDoneWhen: 'off' as const,
  readBeforeEdit: 'require' as const,
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

const { streamChat, executeTool } = vi.hoisted(() => ({
  streamChat: vi.fn(),
  executeTool: vi.fn()
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

import { runAgent } from '@main/agent/loop'
import { resetActiveRunsForTests } from '@main/agent/runRegistry'

describe('runAgent readBeforeEdit require', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-rbe-ws-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    writeFileSync(join(workspace, 'existing.ts'), 'export const n = 1\n')
    resetActiveRunsForTests()
    streamChat.mockReset()
    executeTool.mockReset()
    getSettings.mockClear()
    getSettings.mockImplementation(() => ({
      ...DEFAULT_SETTINGS,
      verifyBeforeDone: 'off' as const,
      contractDoneWhen: 'off' as const,
      readBeforeEdit: 'require' as const,
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

  it('blocks unread edit then allows after read', async () => {
    let call = 0
    const toolResults: Array<{ name: string; ok: boolean; content: string }> = []
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      call += 1
      if (call === 1) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'e1',
            name: 'edit',
            arguments: JSON.stringify({ path: 'existing.ts', contents: 'export const n = 2\n' })
          }
        }
        yield { type: 'done', stopReason: 'tool_calls' }
        return
      }
      if (call === 2) {
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'r1',
            name: 'read',
            arguments: JSON.stringify({ path: 'existing.ts' })
          }
        }
        yield {
          type: 'tool_call',
          toolCall: {
            id: 'e2',
            name: 'edit',
            arguments: JSON.stringify({ path: 'existing.ts', contents: 'export const n = 3\n' })
          }
        }
        yield { type: 'done', stopReason: 'tool_calls' }
        return
      }
      yield { type: 'text', text: 'Updated after read.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })

    executeTool.mockImplementation(async (name: string, argsJson: string) => {
      const args = JSON.parse(argsJson || '{}') as Record<string, unknown>
      if (name === 'read') {
        return { ok: true, content: 'export const n = 1\n' }
      }
      if (name === 'edit') {
        writeFileSync(join(workspace, String(args.path)), String(args.contents ?? ''))
        return { ok: true, content: `wrote ${args.path}` }
      }
      return { ok: false, content: `unexpected ${name}` }
    })

    for await (const ev of runAgent({
      runId: 'rbe-require',
      messages: [{ role: 'user', content: 'edit existing' }],
      workspacePath: workspace,
      mode: 'agent'
    })) {
      if (ev.type === 'tool_result') {
        toolResults.push({ name: ev.name, ok: ev.ok, content: ev.content })
      }
    }

    expect(call).toBe(3)
    const blocked = toolResults.find((r) => r.name === 'edit' && !r.ok)
    expect(blocked?.content).toMatch(/Read-before-edit is set to require/i)
    // First edit was blocked before executeTool; second edit runs after same-step read.
    const editCalls = executeTool.mock.calls.filter((c) => c[0] === 'edit')
    expect(editCalls).toHaveLength(1)
    expect(executeTool.mock.calls.some((c) => c[0] === 'read')).toBe(true)
    expect(readFileSync(join(workspace, 'existing.ts'), 'utf8')).toContain('n = 3')

    const receipt = JSON.parse(
      readFileSync(join(resolveRunDir(workspace, 'rbe-require'), RUN_RECEIPT_FILENAME), 'utf8')
    ) as { status: string }
    expect(receipt.status).toBe('done')
  })

  it('does not apply require gate in Ask mode', async () => {
    streamChat.mockImplementation(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text', text: 'Ask cannot edit.' }
      yield { type: 'done', stopReason: 'end_turn' }
    })

    for await (const _ev of runAgent({
      runId: 'rbe-ask',
      messages: [{ role: 'user', content: 'hi' }],
      workspacePath: workspace,
      mode: 'ask'
    })) {
      // drain
    }

    expect(executeTool).not.toHaveBeenCalled()
  })
})
