import { describe, expect, it, vi } from 'vitest'
import { assembleContext } from '@main/agent/context/assemble'
import type { LlmProvider } from '@main/agent/providers/types'

const mockProvider: LlmProvider = {
  id: 'ollama',
  listModels: async () => [],
  streamChat: async function* () {
    yield { type: 'done' }
  }
}

const model = {
  id: 'test',
  inputModalities: ['text'] as const,
  outputModalities: ['text'] as const,
  supportsTools: true,
  supportsVision: false,
  contextWindow: 100_000
}

describe('assembleContext integration', () => {
  it('injects contract and harness into system prompt', async () => {
    const result = await assembleContext({
      harness: '## Context\nAgent',
      contract: '## Goal\nBuild feature',
      messages: [{ role: 'user', content: 'hello' }],
      workspacePath: null,
      goal: 'hello',
      model,
      toolsJsonEstimate: 100,
      providerId: 'ollama',
      provider: mockProvider,
      signal: new AbortController().signal
    })
    expect(result.system).toContain('## Context')
    expect(result.system).toContain('## Run contract')
    expect(result.system).toContain('Build feature')
  })

  it('preserves prior compaction in system prompt', async () => {
    const result = await assembleContext({
      harness: 'harness',
      messages: [{ role: 'user', content: 'hi' }],
      workspacePath: null,
      goal: 'hi',
      model,
      toolsJsonEstimate: 50,
      priorCompaction: {
        summary: 'Prior work on auth',
        createdAt: '2026-01-01T00:00:00.000Z',
        tokenEstimate: 10
      },
      providerId: 'ollama',
      provider: mockProvider,
      signal: new AbortController().signal
    })
    expect(result.system).toContain('Prior session summary')
    expect(result.system).toContain('Prior work on auth')
  })

  it('injects loop hint as run notice when provided', async () => {
    const result = await assembleContext({
      harness: 'harness',
      messages: [{ role: 'user', content: 'hi' }],
      workspacePath: null,
      goal: 'hi',
      model,
      toolsJsonEstimate: 50,
      loopHint: 'Last 3 agent steps had only tool failures.',
      providerId: 'ollama',
      provider: mockProvider,
      signal: new AbortController().signal
    })
    expect(result.system).toContain('## Run notice')
    expect(result.system).toContain('tool failures')
  })

  it('keeps Ask mode section after compaction rebuild', async () => {
    const longHistory = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i} ${'x'.repeat(2_000)}`
    }))
    const result = await assembleContext({
      harness: 'harness',
      messages: longHistory,
      workspacePath: null,
      goal: 'hi',
      model: { ...model, contextWindow: 8_000 },
      toolsJsonEstimate: 50,
      modeSection: '## Mode: Ask\n\nYou are in Ask mode.',
      providerId: 'ollama',
      provider: mockProvider,
      signal: new AbortController().signal,
      compactionTriggerRatio: 0.1
    })
    expect(result.system).toContain('## Mode: Ask')
    expect(result.system).toContain('You are in Ask mode.')
  })

  it('strips legacy # Run contract H1 before wrapping', async () => {
    const result = await assembleContext({
      harness: '## Context\nAgent',
      contract: '# Run contract\n\n## Goal\nShip it\n\n## Done when\n\n- done\n',
      messages: [{ role: 'user', content: 'hello' }],
      workspacePath: null,
      goal: 'hello',
      model,
      toolsJsonEstimate: 100,
      providerId: 'ollama',
      provider: mockProvider,
      signal: new AbortController().signal
    })
    expect(result.system).toContain('## Run contract')
    expect(result.system).toContain('## Goal')
    expect(result.system).toContain('Ship it')
    expect(result.system.match(/^# Run contract\b/m)).toBeNull()
    expect(result.system.match(/^## Run contract\b/m)).not.toBeNull()
  })

  it('injects plan into system prompt when provided', async () => {
    const result = await assembleContext({
      harness: 'harness',
      contract: '## Goal\nShip',
      plan: '# Plan\n\n1. Do the thing',
      messages: [{ role: 'user', content: 'hello' }],
      workspacePath: null,
      goal: 'hello',
      model,
      toolsJsonEstimate: 100,
      providerId: 'ollama',
      provider: mockProvider,
      signal: new AbortController().signal
    })
    expect(result.system).toContain('## Plan')
    expect(result.system).toContain('Do the thing')
  })

  it('injects session env when provided', async () => {
    const result = await assembleContext({
      harness: 'harness',
      sessionEnv: '## Session\nOS: Windows',
      messages: [{ role: 'user', content: 'hi' }],
      workspacePath: null,
      goal: 'hi',
      model,
      toolsJsonEstimate: 50,
      providerId: 'ollama',
      provider: mockProvider,
      signal: new AbortController().signal
    })
    expect(result.system).toContain('## Session')
    expect(result.system).toContain('OS: Windows')
  })

  it('places stable instruction layers before volatile data', async () => {
    const result = await assembleContext({
      harness: '## Role\nAgent',
      contract: '## Goal\nShip',
      modeSection: '## Mode: Agent\nFull tools.',
      skillsSection: '## Available skills\n- **x**: y',
      pluginRulesSection: '## Plugin rules\n- **plugin-rule:a/b**: c',
      sessionEnv: '## Session\nDate (UTC): 2026-08-01T12:00:00.000Z',
      loopHint: 'tool failures',
      priorCompaction: {
        summary: 'Earlier work',
        createdAt: '2026-01-01T00:00:00.000Z',
        tokenEstimate: 10
      },
      messages: [{ role: 'user', content: 'hi' }],
      workspacePath: null,
      goal: 'hi',
      model,
      toolsJsonEstimate: 50,
      providerId: 'ollama',
      provider: mockProvider,
      signal: new AbortController().signal
    })
    const role = result.system.indexOf('## Role')
    const mode = result.system.indexOf('## Mode: Agent')
    const contract = result.system.indexOf('## Run contract')
    const skills = result.system.indexOf('## Available skills')
    const plugins = result.system.indexOf('## Plugin rules')
    const session = result.system.indexOf('## Session')
    const notice = result.system.indexOf('## Run notice')
    const prior = result.system.indexOf('## Prior session summary')
    expect(role).toBeGreaterThanOrEqual(0)
    expect(mode).toBeGreaterThan(role)
    expect(contract).toBeGreaterThan(mode)
    expect(skills).toBeGreaterThan(contract)
    expect(plugins).toBeGreaterThan(skills)
    expect(session).toBeGreaterThan(plugins)
    expect(notice).toBeGreaterThan(session)
    expect(prior).toBeGreaterThan(notice)
  })

  it('reuses stable prefix cache when only volatile session env changes', async () => {
    const { clearSystemPromptCache } = await import('@main/agent/context/assemble')
    clearSystemPromptCache()
    const base = {
      harness: '## Role\nStable agent',
      contract: '## Goal\nShip',
      messages: [{ role: 'user' as const, content: 'hi' }],
      workspacePath: null as string | null,
      goal: 'hi',
      model,
      toolsJsonEstimate: 50,
      providerId: 'ollama' as const,
      provider: mockProvider,
      signal: new AbortController().signal
    }
    const first = await assembleContext({
      ...base,
      sessionEnv: '## Session\nDate (UTC): 2026-08-01T12:00:00.000Z'
    })
    const second = await assembleContext({
      ...base,
      sessionEnv: '## Session\nDate (UTC): 2026-08-01T12:00:01.000Z'
    })
    const stableMarker = '## Role\nStable agent'
    expect(first.system).toContain(stableMarker)
    expect(second.system).toContain(stableMarker)
    expect(first.system).toContain('12:00:00.000Z')
    expect(second.system).toContain('12:00:01.000Z')
    // Stable contract block is identical across clock ticks.
    const firstStable = first.system.slice(0, first.system.indexOf('## Session'))
    const secondStable = second.system.slice(0, second.system.indexOf('## Session'))
    expect(firstStable).toBe(secondStable)
  })
})
