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
const buildWorkspaceRulesSection = vi.hoisted(() => vi.fn(async () => ''))

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

vi.mock('@main/agent/context/rules', () => ({
  buildWorkspaceRulesSection: (...args: unknown[]) => buildWorkspaceRulesSection(...args)
}))

vi.mock('@main/settings/settings', () => ({
  getSettings: () => getSettings()
}))

vi.mock('@main/settings/secrets', () => ({
  getSecret: (provider: string) => getSecret(provider),
  hasStoredSecretBlob: () => false,
  secretStatus: () => ({ encryptionAvailable: true, keys: {} })
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
  buildSubagentSystem,
  writeSubagentReportFiles,
  type SubagentUpdate
} from '@main/agent/subagent'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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
    buildWorkspaceRulesSection.mockReset()
    buildWorkspaceRulesSection.mockResolvedValue('')
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

  it('registers with subagentRegistry and clears on finish when runId/invokeId set', async () => {
    const {
      countActiveSubagentsForInvoke,
      resetSubagentRegistryForTests
    } = await import('@main/agent/subagentRegistry')
    resetSubagentRegistryForTests()
    streamChat.mockImplementation(
      stream([{ type: 'text', text: 'ok' }, { type: 'done' }])
    )
    await runSubagent({
      task: 'look',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0,
      runId: 'run-reg',
      invokeId: 7
    })
    expect(countActiveSubagentsForInvoke('run-reg', 7)).toBe(0)
  })

  it('aborts via disposeSubagentsForInvoke while streaming', async () => {
    const {
      disposeSubagentsForInvoke,
      countActiveSubagentsForInvoke,
      resetSubagentRegistryForTests
    } = await import('@main/agent/subagentRegistry')
    resetSubagentRegistryForTests()

    let resolveHang: (() => void) | undefined
    const hang = new Promise<void>((r) => {
      resolveHang = r
    })
    streamChat.mockImplementation(async function* (req: { signal?: AbortSignal }) {
      yield { type: 'text' as const, text: 'partial' }
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (req.signal?.aborted) {
          onAbort()
          return
        }
        req.signal?.addEventListener('abort', onAbort, { once: true })
        void hang.then(() => {
          req.signal?.removeEventListener('abort', onAbort)
          resolve()
        })
      })
      yield { type: 'done' as const }
    })

    const parent = new AbortController()
    const running = runSubagent({
      task: 'slow',
      workspace: '/ws',
      signal: parent.signal,
      depth: 0,
      runId: 'run-disp',
      invokeId: 3
    })

    // Allow registration + stream start
    await new Promise((r) => setTimeout(r, 20))
    expect(countActiveSubagentsForInvoke('run-disp', 3)).toBe(1)
    const disposed = await disposeSubagentsForInvoke('run-disp', 3)
    expect(disposed).toBe(1)
    const outcome = await running
    expect(outcome.ok).toBe(false)
    expect(outcome.report).toMatch(/cancelled|abort/i)
    expect(countActiveSubagentsForInvoke('run-disp', 3)).toBe(0)
    resolveHang?.()
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

    const req = streamChat.mock.calls[0]![0] as { tools: { name: string }[]; system?: string }
    expect(req.tools.map((t) => t.name).sort()).toEqual([...SUBAGENT_TOOLS].sort())
  })

  it('lists every SUBAGENT_TOOLS name in the system prompt', async () => {
    streamChat.mockImplementation(stream([{ type: 'text', text: 'done' }, { type: 'done' }]))

    await runSubagent({
      task: 'look around',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    const req = streamChat.mock.calls[0]![0] as { system?: string; messages?: { role: string; content?: string }[] }
    const system =
      req.system ??
      req.messages?.find((m) => m.role === 'system')?.content ??
      ''
    for (const name of SUBAGENT_TOOLS) {
      expect(system).toContain(name)
    }
    expect(system).toMatch(/may run diagnostics/i)
    expect(system).toMatch(/cannot[\s\S]*terminal tool/i)
  })

  it('includes workspace rules in the child system prompt', async () => {
    buildWorkspaceRulesSection.mockResolvedValue(
      '## Workspace rules\n\n### AGENTS.md\nUse the project conventions.'
    )
    streamChat.mockImplementation(stream([{ type: 'text', text: 'done' }, { type: 'done' }]))

    await runSubagent({
      task: 'look around',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    expect(buildWorkspaceRulesSection).toHaveBeenCalledWith('/ws')
    const req = streamChat.mock.calls[0]![0] as { system?: string }
    expect(req.system).toContain('### AGENTS.md')
    expect(req.system).toContain('Use the project conventions.')
  })

  it('injects Session env into the child system prompt', async () => {
    streamChat.mockImplementation(stream([{ type: 'text', text: 'done' }, { type: 'done' }]))

    await runSubagent({
      task: 'look around',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0,
      parentMode: 'plan'
    })

    const req = streamChat.mock.calls[0]![0] as { system?: string }
    expect(req.system).toContain('## Session')
    expect(req.system).toContain('Date (UTC):')
    expect(req.system).toContain('Date (local):')
    expect(req.system).toContain('OS version:')
    expect(req.system).toContain('Interaction mode: plan')
  })

  it('buildSubagentSystem appends session env before rules', () => {
    const system = buildSubagentSystem(
      '## Workspace rules\nBe careful.',
      ['read', 'search'],
      '## Session\nDate (UTC): 2026-01-01T00:00:00.000Z'
    )
    expect(system).toContain('## Session')
    expect(system.indexOf('## Session')).toBeLessThan(system.indexOf('## Workspace rules'))
  })

  it('caps oversized workspace rules in the child system prompt', async () => {
    buildWorkspaceRulesSection.mockResolvedValue(`${'x'.repeat(70_000)}TAIL`)
    streamChat.mockImplementation(stream([{ type: 'text', text: 'done' }, { type: 'done' }]))

    await runSubagent({
      task: 'look around',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0
    })

    const req = streamChat.mock.calls[0]![0] as { system?: string }
    expect(req.system).toContain('… (truncated)')
    expect(req.system).not.toContain('TAIL')
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

    const context = executeTool.mock.calls[0]![4] as { depth: number; agentMode?: string }
    expect(context.depth).toBe(MAX_SUBAGENT_DEPTH)
    expect(context.agentMode).toBe('agent')
  })

  it('runs diagnostics under agent mode when parent is not Ask', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          {
            type: 'tool_call',
            toolCall: {
              id: 't1',
              name: 'diagnostics',
              arguments: '{"kind":"typecheck"}'
            }
          },
          { type: 'done' }
        ])()
      }
      return stream([{ type: 'text', text: 'No type errors.' }, { type: 'done' }])()
    })
    executeTool.mockResolvedValue({
      ok: true,
      summary: 'typecheck',
      content: 'No diagnostics.'
    })

    const outcome = await runSubagent({
      task: 'run typecheck',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0,
      parentMode: 'agent'
    })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(executeTool.mock.calls[0]![0]).toBe('diagnostics')
    const context = executeTool.mock.calls[0]![4] as { agentMode?: string }
    expect(context.agentMode).toBe('agent')
    expect(outcome.ok).toBe(true)
    expect(outcome.report).toBe('No type errors.')
  })

  it('rejects diagnostics when parent mode is Ask', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          {
            type: 'tool_call',
            toolCall: {
              id: 't1',
              name: 'diagnostics',
              arguments: '{"kind":"typecheck"}'
            }
          },
          { type: 'done' }
        ])()
      }
      return stream([{ type: 'text', text: 'Could not run diagnostics.' }, { type: 'done' }])()
    })

    const outcome = await runSubagent({
      task: 'run typecheck',
      workspace: '/ws',
      signal: new AbortController().signal,
      depth: 0,
      parentMode: 'ask'
    })

    expect(executeTool).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
    expect(outcome.report).toBe('Could not run diagnostics.')
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

  it('persists report under runDir/subagents when runDir is set', async () => {
    const runDir = join(tmpdir(), `vyotiq-sub-report-${process.pid}-${Date.now()}`)
    mkdirSync(runDir, { recursive: true })
    try {
      streamChat.mockImplementation(
        stream([{ type: 'text', text: 'Found in a.ts:1.' }, { type: 'done' }])
      )
      const outcome = await runSubagent({
        task: 'Where is foo?',
        workspace: '/ws',
        signal: new AbortController().signal,
        depth: 0,
        runDir
      })
      expect(outcome.ok).toBe(true)
      expect(outcome.reportRel).toMatch(/^subagents\/[a-f0-9]+\/report\.md$/)
      const abs = join(runDir, outcome.reportRel!)
      expect(existsSync(abs)).toBe(true)
      expect(readFileSync(abs, 'utf8')).toMatch(/Found in a\.ts:1/)
      expect(existsSync(join(runDir, 'subagents', outcome.reportRel!.split('/')[1]!, 'status.json'))).toBe(
        true
      )
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })

  it('writeSubagentReportFiles writes report.md and status.json', () => {
    const runDir = join(tmpdir(), `vyotiq-sub-write-${process.pid}-${Date.now()}`)
    mkdirSync(runDir, { recursive: true })
    try {
      const { reportRel, id } = writeSubagentReportFiles(runDir, {
        ok: true,
        report: 'hello',
        steps: 2,
        task: 'find x'
      })
      expect(reportRel).toBe(`subagents/${id}/report.md`)
      expect(readFileSync(join(runDir, reportRel), 'utf8')).toMatch(/hello/)
    } finally {
      rmSync(runDir, { recursive: true, force: true })
    }
  })
})
