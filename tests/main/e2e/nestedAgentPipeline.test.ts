/**
 * Deep nested/subagent pipeline: real runSubagent → runNestedAgent →
 * executeStepToolCalls boundaries with a mocked provider + leaf executeTool.
 * Proves Interrupted vs Cancelled, dispose hard-cancel, tool isolation, and
 * registry lifecycle — not shallow unit stubs of those layers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DEFAULT_SETTINGS } from '@shared/ipc'
import type { StreamChunk } from '@main/agent/providers/types'
import type { AgentEvent } from '@shared/ipc'

const userData = join(tmpdir(), `vyotiq-e2e-nested-${process.pid}-${Date.now()}`)

const streamChat = vi.hoisted(() => vi.fn())
const executeTool = vi.hoisted(() => vi.fn())
const assembleContext = vi.hoisted(() =>
  vi.fn(async (input: { messages: unknown[]; nestedRoleSection?: string }) => ({
    messages: input.messages,
    system: ['system', input.nestedRoleSection].filter(Boolean).join('\n\n'),
    estimatedTokens: 100,
    layers: { system: 10, history: 50, tools: 20, buffer: 20 },
    contextShrunk: false,
    overflow: false,
    anthropicNative: undefined,
    compaction: null
  }))
)
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

vi.mock('@main/agent/harness', () => ({
  loadHarness: () => 'You are Agent V.'
}))

vi.mock('@main/agent/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/context')>()
  return {
    ...actual,
    assembleContext: (...args: unknown[]) => assembleContext(...(args as [never]))
  }
})

vi.mock('@main/agent/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/mcp')>()
  return {
    ...actual,
    syncMcpServers: vi.fn(async () => {}),
    listMcpToolDefinitions: () => []
  }
})

vi.mock('@main/agent/skills', () => ({
  loadEnabledSkills: () => [],
  buildSkillsSection: () => '',
  loadPluginRules: () => ''
}))

vi.mock('@main/marketplace/resolve', () => ({
  resolveEffectiveMcpServers: () => [],
  resolveMcpServersForSessionMap: () => ({}),
  mcpSessionMapFingerprint: () => 'fp'
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

import { runSubagent, NESTED_EXCLUDED_TOOLS } from '@main/agent/subagent'
import {
  disposeSubagentsForInvoke,
  countActiveSubagentsForInvoke,
  resetSubagentRegistryForTests
} from '@main/agent/subagentRegistry'

function stream(chunks: StreamChunk[]) {
  return async function* () {
    for (const chunk of chunks) yield chunk
  }
}

function hangUntilAbort(toolSignal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = (): void => reject(new DOMException('Aborted', 'AbortError'))
    if (toolSignal.aborted) {
      fail()
      return
    }
    toolSignal.addEventListener('abort', fail, { once: true })
  })
}

function combinedParentSignal(run: AbortSignal, soft: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([run, soft])
  }
  return soft
}

function nestedToolResultContents(events: AgentEvent[]): string[] {
  return events
    .filter(
      (ev): ev is AgentEvent & { type: 'subagent_event'; event: { type: 'tool_result'; content: string } } =>
        ev.type === 'subagent_event' && ev.event.type === 'tool_result'
    )
    .map((ev) => ev.event.content)
}

async function waitForToolStarted(): Promise<void> {
  const deadline = Date.now() + 2000
  while (executeTool.mock.calls.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5))
  }
  expect(executeTool.mock.calls.length).toBeGreaterThan(0)
}

describe('e2e nested agent pipeline', () => {
  let workspace: string
  let runDir: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-e2e-nested-ws-${process.pid}-${Date.now()}`)
    runDir = join(workspace, 'run')
    mkdirSync(runDir, { recursive: true })
    resetSubagentRegistryForTests()
    streamChat.mockReset()
    executeTool.mockReset()
    assembleContext.mockClear()
    getSettings.mockClear()
    getSecret.mockReturnValue('key')
    resolveModelInfo.mockClear()
  })

  afterEach(() => {
    resetSubagentRegistryForTests()
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
  })

  it('forwards parent runSignal into nested leaf tool context', async () => {
    const runAc = new AbortController()
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          { type: 'tool_call', toolCall: { id: 't1', name: 'read', arguments: '{"path":"a.ts"}' } },
          { type: 'done', stopReason: 'tool_calls' }
        ])()
      }
      return stream([{ type: 'text', text: 'Nested report.' }, { type: 'done', stopReason: 'end_turn' }])()
    })
    executeTool.mockResolvedValue({ ok: true, summary: 'a.ts', content: 'export {}' })

    const outcome = await runSubagent({
      task: 'read a.ts',
      workspace,
      signal: new AbortController().signal,
      runSignal: runAc.signal,
      depth: 0,
      runId: 'e2e-nested-rs',
      invokeId: 1,
      runDir
    })

    expect(outcome.ok).toBe(true)
    expect(executeTool).toHaveBeenCalled()
    const ctx = executeTool.mock.calls[0]![4] as { runSignal?: AbortSignal; depth?: number }
    expect(ctx.depth).toBe(1)
    expect(ctx.runSignal?.aborted).toBe(false)
    runAc.abort()
    expect(ctx.runSignal?.aborted).toBe(true)
  })

  it('soft parent abort labels nested in-flight tools Interrupted', async () => {
    const runAc = new AbortController()
    const softAc = new AbortController()
    const parentSignal = combinedParentSignal(runAc.signal, softAc.signal)
    const events: AgentEvent[] = []

    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          { type: 'tool_call', toolCall: { id: 't1', name: 'read', arguments: '{"path":"a.ts"}' } },
          { type: 'done', stopReason: 'tool_calls' }
        ])()
      }
      return stream([{ type: 'text', text: 'should not finish' }, { type: 'done' }])()
    })
    executeTool.mockImplementation(async (_n, _a, _w, toolSignal: AbortSignal) => hangUntilAbort(toolSignal))

    const running = runSubagent({
      task: 'slow read',
      workspace,
      signal: parentSignal,
      runSignal: runAc.signal,
      depth: 0,
      runId: 'e2e-nested-soft',
      invokeId: 2,
      parentToolCallId: 'parent-soft',
      runDir,
      emitAgentEvent: (ev) => events.push(ev)
    })

    await waitForToolStarted()
    softAc.abort()
    const outcome = await running

    expect(nestedToolResultContents(events)).toContain('Interrupted')
    expect(nestedToolResultContents(events)).not.toContain('Cancelled')
    expect(outcome.ok).toBe(false)
    expect(outcome.report).toMatch(/interrupted/i)
    expect(outcome.report).not.toMatch(/cancelled/i)
    expect(countActiveSubagentsForInvoke('e2e-nested-soft', 2)).toBe(0)
  })

  it('hard parent cancel labels nested in-flight tools Cancelled', async () => {
    const runAc = new AbortController()
    const softAc = new AbortController()
    const parentSignal = combinedParentSignal(runAc.signal, softAc.signal)
    const events: AgentEvent[] = []

    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          { type: 'tool_call', toolCall: { id: 't1', name: 'read', arguments: '{"path":"a.ts"}' } },
          { type: 'done', stopReason: 'tool_calls' }
        ])()
      }
      return stream([{ type: 'text', text: 'nope' }, { type: 'done' }])()
    })
    executeTool.mockImplementation(async (_n, _a, _w, toolSignal: AbortSignal) => hangUntilAbort(toolSignal))

    const running = runSubagent({
      task: 'slow read',
      workspace,
      signal: parentSignal,
      runSignal: runAc.signal,
      depth: 0,
      runId: 'e2e-nested-hard',
      invokeId: 3,
      parentToolCallId: 'parent-hard',
      runDir,
      emitAgentEvent: (ev) => events.push(ev)
    })

    await waitForToolStarted()
    runAc.abort()
    const outcome = await running

    expect(nestedToolResultContents(events)).toContain('Cancelled')
    expect(outcome.ok).toBe(false)
    expect(outcome.report).toMatch(/cancelled/i)
    expect(countActiveSubagentsForInvoke('e2e-nested-hard', 3)).toBe(0)
  })

  it('disposeSubagentsForInvoke labels nested in-flight tools Cancelled', async () => {
    const events: AgentEvent[] = []
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          { type: 'tool_call', toolCall: { id: 't1', name: 'read', arguments: '{"path":"a.ts"}' } },
          { type: 'done', stopReason: 'tool_calls' }
        ])()
      }
      return stream([{ type: 'text', text: 'nope' }, { type: 'done' }])()
    })
    executeTool.mockImplementation(async (_n, _a, _w, toolSignal: AbortSignal) => hangUntilAbort(toolSignal))

    const parent = new AbortController()
    const runAc = new AbortController()
    const running = runSubagent({
      task: 'slow read',
      workspace,
      signal: parent.signal,
      runSignal: runAc.signal,
      depth: 0,
      runId: 'e2e-nested-disp',
      invokeId: 4,
      parentToolCallId: 'parent-disp',
      runDir,
      emitAgentEvent: (ev) => events.push(ev)
    })

    await waitForToolStarted()
    expect(countActiveSubagentsForInvoke('e2e-nested-disp', 4)).toBe(1)
    const disposed = await disposeSubagentsForInvoke('e2e-nested-disp', 4)
    expect(disposed).toBe(1)
    const outcome = await running

    expect(nestedToolResultContents(events)).toContain('Cancelled')
    expect(nestedToolResultContents(events)).not.toContain('Interrupted')
    expect(outcome.ok).toBe(false)
    expect(runAc.signal.aborted).toBe(false)
    expect(countActiveSubagentsForInvoke('e2e-nested-disp', 4)).toBe(0)
  })

  it('denies nested subagent/switch_mode without calling leaf executeTool', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          {
            type: 'tool_call',
            toolCall: { id: 't1', name: 'subagent', arguments: '{"task":"nested"}' }
          },
          {
            type: 'tool_call',
            toolCall: { id: 't2', name: 'switch_mode', arguments: '{"mode":"ask"}' }
          },
          { type: 'done', stopReason: 'tool_calls' }
        ])()
      }
      return stream([{ type: 'text', text: 'Denied tools; done.' }, { type: 'done' }])()
    })

    const nestedEvents: AgentEvent[] = []
    const outcome = await runSubagent({
      task: 'try recurse',
      workspace,
      signal: new AbortController().signal,
      depth: 0,
      runId: 'e2e-nested-deny',
      invokeId: 5,
      parentToolCallId: 'parent-sa',
      runDir,
      emitAgentEvent: (ev) => nestedEvents.push(ev)
    })

    expect(executeTool).not.toHaveBeenCalled()
    expect(outcome.ok).toBe(true)
    expect(outcome.report).toBe('Denied tools; done.')
    for (const name of NESTED_EXCLUDED_TOOLS) {
      const denied = nestedEvents.some(
        (ev) =>
          ev.type === 'subagent_event' &&
          ev.event.type === 'tool_result' &&
          ev.event.name === name &&
          ev.event.ok === false
      )
      expect(denied).toBe(true)
    }
    expect(outcome.reportRel).toMatch(/^subagents\/[a-f0-9]+\/report\.md$/)
    const reportPath = join(runDir, outcome.reportRel!)
    expect(existsSync(reportPath)).toBe(true)
    expect(readFileSync(reportPath, 'utf8')).toContain('Denied tools; done.')
  })

  it('wraps nested live events as subagent_event with parentToolCallId', async () => {
    let call = 0
    streamChat.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return stream([
          { type: 'tool_call', toolCall: { id: 'n1', name: 'read', arguments: '{"path":"z.ts"}' } },
          { type: 'done', stopReason: 'tool_calls' }
        ])()
      }
      return stream([{ type: 'text', text: 'Found z.' }, { type: 'done' }])()
    })
    executeTool.mockResolvedValue({ ok: true, summary: 'z.ts', content: 'z' })

    const events: AgentEvent[] = []
    await runSubagent({
      task: 'read z',
      workspace,
      signal: new AbortController().signal,
      depth: 0,
      runId: 'e2e-nested-ev',
      invokeId: 6,
      parentToolCallId: 'parent-tool',
      runDir,
      emitAgentEvent: (ev) => events.push(ev)
    })

    const wrapped = events.filter((e) => e.type === 'subagent_event')
    expect(wrapped.length).toBeGreaterThan(0)
    expect(wrapped.every((e) => e.type === 'subagent_event' && e.parentToolCallId === 'parent-tool')).toBe(
      true
    )
    expect(
      wrapped.some(
        (e) =>
          e.type === 'subagent_event' &&
          e.event.type === 'tool_result' &&
          e.event.toolCallId === 'n1' &&
          e.event.ok === true
      )
    ).toBe(true)
  })
})
