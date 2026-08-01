import { describe, expect, it } from 'vitest'
import {
  anthropicUsesAdaptiveThinking,
  anthropicUsesManualThinking,
  modelSupportsThinking,
  thinkingApiFor,
  ProviderReasoningStateSchema,
  normalizeEffortForOpenAiResponses,
  normalizeEffortForGeminiInteractions,
  trailingToolMessages
} from '@shared/reasoning'

describe('reasoning', () => {
  it('detects thinking-capable models', () => {
    expect(modelSupportsThinking('gpt-5.6', 'openai')).toBe(true)
    expect(modelSupportsThinking('openai/gpt-5.6', 'openrouter')).toBe(true)
    expect(modelSupportsThinking('claude-sonnet-5', 'anthropic')).toBe(true)
    expect(modelSupportsThinking('gemini-3.5-flash', 'gemini')).toBe(true)
    expect(modelSupportsThinking('deepseek-v4-pro', 'deepseek')).toBe(true)
    expect(modelSupportsThinking('gpt-4o', 'openai')).toBe(false)
  })

  it('maps thinking API per provider', () => {
    expect(thinkingApiFor('gpt-5.6', 'openai')).toBe('responses')
    expect(thinkingApiFor('gemini-3.5-flash', 'gemini')).toBe('interactions')
    expect(thinkingApiFor('claude-sonnet-5', 'anthropic')).toBe('messages')
    expect(thinkingApiFor('deepseek-v4-pro', 'deepseek')).toBe('chat_completions')
  })

  it('classifies Anthropic thinking modes', () => {
    expect(anthropicUsesAdaptiveThinking('claude-sonnet-5')).toBe(true)
    expect(anthropicUsesAdaptiveThinking('claude-opus-5')).toBe(true)
    expect(anthropicUsesManualThinking('claude-sonnet-4-6')).toBe(true)
    expect(anthropicUsesManualThinking('claude-sonnet-5')).toBe(false)
    expect(anthropicUsesManualThinking('claude-opus-5')).toBe(false)
  })

  it('round-trips provider reasoning state', () => {
    const state = {
      kind: 'openai_compat' as const,
      reasoningContent: 'step 1',
      reasoningDetails: [{ type: 'reasoning.text', text: 'step 1' }]
    }
    expect(ProviderReasoningStateSchema.parse(state)).toEqual(state)
  })

  it('normalizes effort for OpenAI Responses', () => {
    expect(normalizeEffortForOpenAiResponses('max')).toBe('xhigh')
    expect(normalizeEffortForOpenAiResponses('high')).toBe('high')
    expect(normalizeEffortForOpenAiResponses(undefined, false)).toBe('none')
  })

  it('normalizes effort for Gemini Interactions', () => {
    expect(normalizeEffortForGeminiInteractions('xhigh')).toBe('high')
    expect(normalizeEffortForGeminiInteractions('max')).toBe('high')
    expect(normalizeEffortForGeminiInteractions(undefined)).toBe('medium')
  })

  it('collects trailing tool messages only', () => {
    const messages = [
      { role: 'user' as const, content: 'go' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool' as const, toolCallId: 'c1', toolName: 'read', content: 'ok' },
      { role: 'tool' as const, toolCallId: 'c2', toolName: 'edit', content: 'done' }
    ]
    expect(trailingToolMessages(messages)).toHaveLength(2)
    expect(trailingToolMessages(messages).every((m) => m.role === 'tool')).toBe(true)
  })
})
