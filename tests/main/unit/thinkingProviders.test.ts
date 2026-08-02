import { describe, expect, it } from 'vitest'
import { buildOpenAiCompatBody } from '@main/agent/providers/openai'
import { anthropicThinkingFields } from '@main/agent/providers/thinkingPolicy'
import type { ProviderChatRequest } from '@main/agent/providers/types'

const baseReq = (partial: Partial<ProviderChatRequest> = {}): ProviderChatRequest => ({
  model: 'deepseek-v4-pro',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  signal: new AbortController().signal,
  apiKey: 'test',
  thinking: { enabled: true, effort: 'high' },
  ...partial
})

describe('openai compat thinking body', () => {
  it('adds DeepSeek thinking fields when enabled', () => {
    const body = buildOpenAiCompatBody(baseReq(), { defaultBaseUrl: 'https://api.deepseek.com/v1', deepseekThinking: true }, 'deepseek')
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('high')
  })

  it('adds OpenRouter reasoning param when enabled', () => {
    const body = buildOpenAiCompatBody(
      baseReq({ model: 'anthropic/claude-sonnet-5' }),
      { defaultBaseUrl: 'https://openrouter.ai/api/v1', openRouterReasoning: true },
      'openrouter'
    )
    expect(body.reasoning).toEqual({ effort: 'high' })
  })

  it('replays reasoning_content on assistant tool-call messages', () => {
    const body = buildOpenAiCompatBody(
      baseReq({
        messages: [
          {
            role: 'assistant',
            content: '',
            thinking: 'internal',
            reasoningState: { kind: 'openai_compat', reasoningContent: 'internal' },
            toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
          }
        ]
      }),
      { defaultBaseUrl: 'https://api.deepseek.com/v1', deepseekThinking: true },
      'deepseek'
    )
    const assistant = (body.messages as Array<Record<string, unknown>>).find(
      (m) => m.role === 'assistant'
    )
    expect(assistant?.reasoning_content).toBe('internal')
  })

  it('adds Groq reasoning fields when enabled', () => {
    const body = buildOpenAiCompatBody(
      baseReq({ thinking: { enabled: true, effort: 'high', display: 'omitted' } }),
      { defaultBaseUrl: 'https://api.groq.com/openai/v1' },
      'groq'
    )
    expect(body.reasoning_effort).toBe('high')
    expect(body.reasoning_format).toBe('hidden')
    expect(body.include_reasoning).toBeUndefined()
  })

  it('adds Groq include_reasoning when display is summarized', () => {
    const body = buildOpenAiCompatBody(
      baseReq({ thinking: { enabled: true, effort: 'medium', display: 'summarized' } }),
      { defaultBaseUrl: 'https://api.groq.com/openai/v1' },
      'groq'
    )
    expect(body.include_reasoning).toBe(true)
    expect(body.reasoning_format).toBeUndefined()
  })

  it('adds xAI reasoning_effort when enabled', () => {
    const body = buildOpenAiCompatBody(
      baseReq({ thinking: { enabled: true, effort: 'minimal' } }),
      { defaultBaseUrl: 'https://api.x.ai/v1' },
      'xai'
    )
    expect(body.reasoning_effort).toBe('low')
  })

  it('adds Ollama think flag when enabled', () => {
    const body = buildOpenAiCompatBody(
      baseReq(),
      { defaultBaseUrl: 'http://localhost:11434', ollamaVision: true },
      'ollama'
    )
    expect(body.think).toBe(true)
  })

  it('normalizes DeepSeek effort values', () => {
    const body = buildOpenAiCompatBody(
      baseReq({ thinking: { enabled: true, effort: 'minimal' } }),
      { defaultBaseUrl: 'https://api.deepseek.com/v1', deepseekThinking: true },
      'deepseek'
    )
    expect(body.reasoning_effort).toBe('low')
  })
})

describe('anthropic thinking fields', () => {
  it('uses adaptive thinking on Sonnet 5', () => {
    const fields = anthropicThinkingFields(
      baseReq({ model: 'claude-sonnet-5', thinking: { enabled: true, effort: 'high' } })
    )
    expect(fields.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(fields.output_config).toEqual({ effort: 'high' })
  })

  it('uses adaptive thinking on Sonnet 4.6', () => {
    const fields = anthropicThinkingFields(
      baseReq({ model: 'claude-sonnet-4-6', thinking: { enabled: true, effort: 'medium' } })
    )
    expect(fields.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(fields.output_config).toEqual({ effort: 'medium' })
  })

  it('maps minimal effort to low on Anthropic adaptive', () => {
    const fields = anthropicThinkingFields(
      baseReq({ model: 'claude-opus-4-7', thinking: { enabled: true, effort: 'minimal' } })
    )
    expect(fields.output_config).toEqual({ effort: 'low' })
  })

  it('disables thinking explicitly on adaptive models when off', () => {
    const fields = anthropicThinkingFields(
      baseReq({ model: 'claude-sonnet-4-6', thinking: { enabled: false } })
    )
    expect(fields.thinking).toEqual({ type: 'disabled' })
  })

  it('uses manual budget on older Claude models', () => {
    const fields = anthropicThinkingFields(
      baseReq({
        model: 'claude-sonnet-4-5',
        thinking: { enabled: true, effort: 'high' }
      })
    )
    expect(fields.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 })
  })
})
