import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/ipc'
import type { StreamChunk } from '@main/agent/providers/types'

const streamChat = vi.hoisted(() => vi.fn())
const executeTool = vi.hoisted(() => vi.fn())

vi.mock('@main/agent/providers', () => ({
  getProvider: () => ({
    id: 'openai',
    streamChat: (req: unknown) => streamChat(req),
    listModels: async () => []
  }),
  listProviderModels: async () => ({ models: [] })
}))

vi.mock('@main/agent/modelResolve', () => ({
  resolveModelInfo: async () => ({
    id: 'test-model',
    displayName: 'test',
    contextWindow: 128_000,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: true
  })
}))

vi.mock('@main/agent/tools', () => ({
  executeTool: (...args: unknown[]) => executeTool(...args)
}))

vi.mock('@main/settings/settings', () => ({
  getSettings: () => ({ ...DEFAULT_SETTINGS, provider: 'openai', model: 'test-model' })
}))

vi.mock('@main/settings/secrets', () => ({
  getSecret: () => 'key'
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

  it('stops at its own step budget', async () => {
    streamChat.mockImplementation(
      stream([
        { type: 'text', text: 'thinking out loud' },
        { type: 'tool_call', toolCall: { id: 't1', name: 'grep', arguments: '{"pattern":"x"}' } },
        { type: 'done' }
      ])
    )
    executeTool.mockResolvedValue({ ok: true, summary: 'x', content: 'hit' })

    const outcome = await runSubagent({
      task: 'loop forever',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0,
      maxSteps: 3
    })

    expect(outcome.steps).toBe(3)
    expect(outcome.report).toBe('thinking out loud')
  })
})
