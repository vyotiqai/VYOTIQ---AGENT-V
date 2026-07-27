import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/ipc'
import type { StreamChunk } from '@main/agent/providers/types'

const streamChat = vi.hoisted(() => vi.fn())
const executeTool = vi.hoisted(() => vi.fn())
const getSettings = vi.hoisted(() =>
  vi.fn(() => ({ ...DEFAULT_SETTINGS, provider: 'openai' as const, model: 'test-model' }))
)
const getSecret = vi.hoisted(() => vi.fn(() => 'key' as string | null))
const resolveModelInfo = vi.hoisted(() =>
  vi.fn(async (_provider: string, modelId: string) => ({
    id: modelId,
    displayName: modelId,
    contextWindow: 128_000,
    inputModalities: ['text'] as const,
    outputModalities: ['text'] as const,
    supportsTools: true
  }))
)

vi.mock('@main/agent/providers', () => ({
  getProvider: () => ({
    id: 'openai',
    streamChat: (req: unknown) => streamChat(req),
    listModels: async () => []
  }),
  listProviderModels: async () => ({ models: [] })
}))

vi.mock('@main/agent/modelResolve', () => ({
  resolveModelInfo: (...args: unknown[]) => resolveModelInfo(...args)
}))

vi.mock('@main/agent/tools', () => ({
  executeTool: (...args: unknown[]) => executeTool(...args)
}))

vi.mock('@main/settings/settings', () => ({
  getSettings: () => getSettings()
}))

vi.mock('@main/settings/secrets', () => ({
  getSecret: (provider: string) => getSecret(provider)
}))

vi.mock('@main/workspace/workspaces', () => ({
  readWorkspacesState: () => ({ settingsOverridesByPath: {} }),
  findWorkspaceSettingsOverride: () => null
}))

import {
  MAX_SUBAGENT_DEPTH,
  runSubagent,
  SubagentDepthError,
  SUBAGENT_TOOLS,
  type SubagentUpdate
} from '@main/agent/subagent'

function stream(chunks: StreamChunk[]) {
  return async function* () {
    for (const chunk of chunks) yield chunk
  }
}

describe('runSubagent', () => {
  beforeEach(() => {
    streamChat.mockReset()
    executeTool.mockReset()
    getSettings.mockReset()
    getSecret.mockReset()
    getSecret.mockReturnValue('key')
    getSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      provider: 'openai',
      model: 'test-model'
    })
    resolveModelInfo.mockClear()
  })

  it('returns the final report as the tool result', async () => {
    streamChat.mockImplementation(
      stream([{ type: 'text', text: 'Auth lives in src/auth.ts:12.' }, { type: 'done' }])
    )

    const outcome = await runSubagent({
      task: 'Where does auth live?',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.report).toBe('Auth lives in src/auth.ts:12.')
    expect(outcome.steps).toBe(1)
  })

  it('fails fast when the sub-agent provider API key is missing', async () => {
    getSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      provider: 'ollama',
      model: 'qwen2.5',
      subagentProvider: 'openai',
      subagentModel: 'gpt-5.6'
    })
    getSecret.mockReturnValue(null)

    const outcome = await runSubagent({
      task: 'look',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.steps).toBe(0)
    expect(outcome.report).toMatch(/API key for openai is not set/i)
    expect(streamChat).not.toHaveBeenCalled()
    expect(resolveModelInfo).not.toHaveBeenCalled()
  })

  it('emits context usage each step', async () => {
    streamChat.mockImplementation(
      stream([{ type: 'text', text: 'done' }, { type: 'done' }])
    )

    const usage: unknown[] = []
    await runSubagent({
      task: 'look',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0,
      onContextUsage: (u) => usage.push(u)
    })

    expect(usage.length).toBe(1)
    expect(usage[0]).toMatchObject({ step: 1, contextWindow: 128_000, model: 'test-model' })
  })

  it('uses dedicated subagent model when configured', async () => {
    getSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      provider: 'openai',
      model: 'parent-model',
      subagentProvider: 'openai',
      subagentModel: 'subagent-model'
    })
    streamChat.mockImplementation(stream([{ type: 'text', text: 'ok' }, { type: 'done' }]))

    await runSubagent({
      task: 'look',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(resolveModelInfo.mock.calls[0]?.[0]).toBe('openai')
    expect(resolveModelInfo.mock.calls[0]?.[1]).toBe('subagent-model')
    const req = streamChat.mock.calls[0]![0] as { model: string }
    expect(req.model).toBe('subagent-model')
  })

  it('uses provider default model when only subagent provider is set', async () => {
    getSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      provider: 'openai',
      model: 'parent-openai-model',
      subagentProvider: 'anthropic'
    })
    streamChat.mockImplementation(stream([{ type: 'text', text: 'ok' }, { type: 'done' }]))

    await runSubagent({
      task: 'look',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(resolveModelInfo.mock.calls[0]?.[0]).toBe('anthropic')
    expect(resolveModelInfo.mock.calls[0]?.[1]).not.toBe('parent-openai-model')
    const req = streamChat.mock.calls[0]![0] as { model: string; serviceTier?: string }
    expect(req.model).not.toBe('parent-openai-model')
  })

  it('resolves serviceTier from serviceTierByModel for the subagent model', async () => {
    getSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      provider: 'openai',
      model: 'parent-model',
      subagentModel: 'subagent-model',
      serviceTier: 'default',
      serviceTierByModel: {
        'openai::subagent-model': 'priority',
        'openai::parent-model': 'flex'
      }
    })
    streamChat.mockImplementation(stream([{ type: 'text', text: 'ok' }, { type: 'done' }]))

    await runSubagent({
      task: 'look',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    const req = streamChat.mock.calls[0]![0] as { serviceTier?: string }
    expect(req.serviceTier).toBe('priority')
  })

  it('falls back to parent model when subagent model is unset', async () => {
    getSettings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      provider: 'openai',
      model: 'parent-model'
    })
    streamChat.mockImplementation(stream([{ type: 'text', text: 'ok' }, { type: 'done' }]))

    await runSubagent({
      task: 'look',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    const req = streamChat.mock.calls[0]![0] as { model: string }
    expect(req.model).toBe('parent-model')
  })

  it('passes prepared (trimmed) messages to streamChat on later steps', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call <= 4) {
        return stream([
          {
            type: 'tool_call',
            toolCall: { id: `t${call}`, name: 'read', arguments: `{"path":"f${call}.ts"}` }
          },
          { type: 'done' }
        ])()
      }
      return stream([{ type: 'text', text: 'done investigating.' }, { type: 'done' }])()
    })
    executeTool.mockResolvedValue({
      ok: true,
      summary: 'file',
      content: 'BODY'.repeat(4_000)
    })

    await runSubagent({
      task: 'investigate many files',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(streamChat.mock.calls.length).toBeGreaterThanOrEqual(5)
    const lastReq = streamChat.mock.calls.at(-1)![0] as {
      messages: { role: string; content?: string }[]
    }
    const toolBodies = lastReq.messages.filter((m) => m.role === 'tool')
    expect(toolBodies.some((m) => String(m.content).includes('cleared'))).toBe(true)
  })

  it('offers only read-only tools to the child model', async () => {
    streamChat.mockImplementation(stream([{ type: 'text', text: 'done' }, { type: 'done' }]))

    await runSubagent({
      task: 'look around',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    const req = streamChat.mock.calls[0]![0] as { tools: { name: string }[] }
    expect(req.tools.map((t) => t.name).sort()).toEqual([...SUBAGENT_TOOLS].sort())
  })

  it('runs tool calls and reports progress before the report', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          { type: 'tool_call', toolCall: { id: 't1', name: 'read', arguments: '{"path":"a.ts"}' } },
          { type: 'done' }
        ])()
      }
      return stream([{ type: 'text', text: 'a.ts exports foo.' }, { type: 'done' }])()
    })
    executeTool.mockResolvedValue({ ok: true, summary: 'a.ts', content: 'export const foo = 1' })

    const updates: SubagentUpdate[] = []
    const outcome = await runSubagent({
      task: 'what does a.ts export',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0,
      emit: (update) => updates.push(update)
    })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(outcome.report).toBe('a.ts exports foo.')
    expect(updates.map((u) => u.kind)).toEqual(['tool', 'text', 'done'])
    expect(updates[0]!.text).toContain('read')
  })

  it('does not treat intermediate narration as a final report', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          { type: 'text', text: 'Let me search…' },
          { type: 'tool_call', toolCall: { id: 't1', name: 'read', arguments: '{"path":"a.ts"}' } },
          { type: 'done' }
        ])()
      }
      return stream([{ type: 'done' }])()
    })
    executeTool.mockResolvedValue({ ok: true, summary: 'a.ts', content: 'x' })

    const outcome = await runSubagent({
      task: 'what does a.ts export',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.report).toMatch(/without a final report/i)
  })

  it('passes an incremented depth so the child cannot recurse', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          { type: 'tool_call', toolCall: { id: 't1', name: 'read', arguments: '{"path":"a.ts"}' } },
          { type: 'done' }
        ])()
      }
      return stream([{ type: 'text', text: 'report' }, { type: 'done' }])()
    })
    executeTool.mockResolvedValue({ ok: true, summary: 'a.ts', content: 'x' })

    await runSubagent({
      task: 'read a.ts',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    const context = executeTool.mock.calls[0]![4] as { depth: number }
    expect(context.depth).toBe(MAX_SUBAGENT_DEPTH)
  })

  it('refuses to nest a second level', async () => {
    await expect(
      runSubagent({
        task: 'spawn another',
        workspace: '/ws',
        signal: new AbortController().signal,
        depth: MAX_SUBAGENT_DEPTH
      })
    ).rejects.toBeInstanceOf(SubagentDepthError)
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('rejects mutating tools even if the model emits them', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          {
            type: 'tool_call',
            toolCall: { id: 't1', name: 'edit', arguments: '{"path":"a.ts","contents":"x"}' }
          },
          { type: 'done' }
        ])()
      }
      return stream([{ type: 'text', text: 'Could not edit; used read-only tools only.' }, { type: 'done' }])()
    })

    const outcome = await runSubagent({
      task: 'try to edit',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(executeTool).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
    expect(outcome.report).toContain('read-only')
  })

  it('propagates ok: false from child tool results', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          { type: 'tool_call', toolCall: { id: 't1', name: 'read', arguments: '{"path":"missing.ts"}' } },
          { type: 'done' }
        ])()
      }
      return stream([{ type: 'text', text: 'File was missing.' }, { type: 'done' }])()
    })
    executeTool.mockResolvedValue({ ok: false, summary: 'missing.ts', content: 'File not found' })

    await runSubagent({
      task: 'read missing',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    const secondReq = streamChat.mock.calls[1]![0] as {
      messages: { role: string; ok?: boolean }[]
    }
    const toolMsg = secondReq.messages.find((m) => m.role === 'tool')
    expect(toolMsg?.ok).toBe(false)
  })

  it('retries on retriable provider stream errors', async () => {
    let attempt = 0
    streamChat.mockImplementation(() => {
      attempt += 1
      if (attempt === 1) {
        return stream([
          { type: 'text', text: 'doomed first attempt' },
          { type: 'error', error: 'socket hang up' }
        ])()
      }
      return stream([{ type: 'text', text: 'Recovered report after retry.' }, { type: 'done' }])()
    })

    const result = await runSubagent({
      task: 'investigate flaky provider',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(result.ok).toBe(true)
    expect(result.report).toBe('Recovered report after retry.')
    expect(streamChat).toHaveBeenCalledTimes(2)
  })

  it('fails immediately on non-retriable provider stream errors', async () => {
    streamChat.mockImplementation(() =>
      stream([{ type: 'error', error: 'invalid_api_key' }])()
    )

    const result = await runSubagent({
      task: 'investigate auth failure',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(result.ok).toBe(false)
    expect(result.report).toContain('invalid_api_key')
    expect(streamChat).toHaveBeenCalledTimes(1)
  })
})
