import { describe, expect, it } from 'vitest'
import {
  baseModelInfo,
  normalizeOpenAiStyleModels,
  thinkingPartialFromCatalogRow
} from '@main/agent/providers/normalize'

describe('catalog thinking fields', () => {
  it('maps OpenRouter reasoning object into ModelInfo', () => {
    const models = normalizeOpenAiStyleModels(
      {
        data: [
          {
            id: 'google/gemini-3.5-flash',
            name: 'Gemini 3.5 Flash',
            supported_parameters: ['tools', 'reasoning'],
            reasoning: {
              supported_efforts: ['high', 'medium', 'low', 'minimal', 'none'],
              default_effort: 'medium',
              default_enabled: true,
              mandatory: true,
              supports_max_tokens: false
            },
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            context_length: 128000
          }
        ]
      },
      { providerId: 'openrouter', requireToolsParam: true }
    )
    expect(models).toHaveLength(1)
    const m = models[0]!
    expect(m.supportsThinking).toBe(true)
    expect(m.supportedThinkingEfforts).toEqual(['high', 'medium', 'low', 'minimal'])
    expect(m.thinkingCanDisable).toBe(false)
    expect(m.thinkingDefaultEffort).toBe('medium')
    expect(m.thinkingApi).toBe('chat_completions')
  })

  it('infers thinking from supported_parameters when reasoning object absent', () => {
    const partial = thinkingPartialFromCatalogRow(
      { id: 'x', supported_parameters: ['tools', 'reasoning_effort'] },
      'openrouter'
    )
    expect(partial.supportsThinking).toBe(true)
  })

  it('falls back to heuristic when catalog omits thinking', () => {
    const m = baseModelInfo('gpt-5.6', {}, 'openai')
    expect(m.supportsThinking).toBe(true)
    expect(m.thinkingApi).toBe('responses')
    expect(m.supportedThinkingEfforts).toContain('high')
  })

  it('marks ollama think models when providerId is passed', () => {
    const m = baseModelInfo('deepseek-r1:latest', { supportsTools: true }, 'ollama')
    expect(m.supportsThinking).toBe(true)
    expect(m.thinkingMode).toBe('boolean')
  })

  it('sets adaptive mode for Anthropic 4.6 via provider defaults', () => {
    const m = baseModelInfo('claude-sonnet-4-6', {}, 'anthropic')
    expect(m.supportsThinking).toBe(true)
    expect(m.thinkingMode).toBe('adaptive')
    expect(m.thinkingApi).toBe('messages')
  })
})
