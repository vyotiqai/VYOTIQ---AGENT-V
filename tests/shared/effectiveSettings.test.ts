import { describe, expect, it } from 'vitest'
import { resolveEffectiveSettings } from '@shared/effectiveSettings'
import { DEFAULT_SETTINGS } from '@shared/ipc'

describe('resolveEffectiveSettings', () => {
  it('returns global chat settings when override is off', () => {
    const effective = resolveEffectiveSettings(DEFAULT_SETTINGS, {
      useOverride: false,
      provider: 'openai',
      model: 'gpt-5.6',
      thinkingEffort: 'max'
    })
    expect(effective.provider).toBe(DEFAULT_SETTINGS.provider)
    expect(effective.model).toBe(DEFAULT_SETTINGS.model)
    expect(effective.thinkingEffort).toBe(DEFAULT_SETTINGS.thinkingEffort)
    expect(effective.thinkingEnabled).toBe(DEFAULT_SETTINGS.thinkingEnabled)
  })

  it('merges thinking and agent fields from workspace override', () => {
    const effective = resolveEffectiveSettings(DEFAULT_SETTINGS, {
      useOverride: true,
      provider: 'openai',
      model: 'gpt-5.6',
      subagentProvider: 'anthropic',
      subagentModel: 'claude-sonnet-5',
      thinkingEnabled: false,
      thinkingEffort: 'high',
      showThinking: false,
      compactionTriggerRatio: 0.85,
      keepRecentTurns: 20,
    })
    expect(effective).toEqual({
      provider: 'openai',
      model: 'gpt-5.6',
      ollamaBaseUrl: DEFAULT_SETTINGS.ollamaBaseUrl,
      subagentProvider: 'anthropic',
      subagentModel: 'claude-sonnet-5',
      thinkingEnabled: false,
      thinkingEffort: 'high',
      showThinking: false,
      compactionTriggerRatio: 0.85,
      keepRecentTurns: 20,
      toolApproval: DEFAULT_SETTINGS.toolApproval
    })
  })

  it('falls back to global subagent fields when override omits them', () => {
    const effective = resolveEffectiveSettings(
      {
        ...DEFAULT_SETTINGS,
        subagentProvider: 'openai',
        subagentModel: 'gpt-5.6'
      },
      {
        useOverride: true,
        provider: 'anthropic',
        model: 'claude-sonnet-5'
      }
    )
    expect(effective.subagentProvider).toBe('openai')
    expect(effective.subagentModel).toBe('gpt-5.6')
  })

  it('takes the tool approval policy from the workspace override', () => {
    const effective = resolveEffectiveSettings(DEFAULT_SETTINGS, {
      useOverride: true,
      toolApproval: { mode: 'mutating', allowlist: ['terminal'] }
    })
    expect(effective.toolApproval).toEqual({ mode: 'mutating', allowlist: ['terminal'] })
  })

  it('falls back to global for missing override fields', () => {
    const effective = resolveEffectiveSettings(
      { ...DEFAULT_SETTINGS, thinkingEffort: 'low', showThinking: false },
      {
        useOverride: true,
        provider: 'anthropic',
        model: 'claude-sonnet-5'
      }
    )
    expect(effective.provider).toBe('anthropic')
    expect(effective.model).toBe('claude-sonnet-5')
    expect(effective.thinkingEffort).toBe('low')
    expect(effective.showThinking).toBe(false)
  })
})
