import { describe, expect, it } from 'vitest'
import {
  compatStreamOptions,
  buildOpenAiCompatBody,
  openAiCompatMessageReasoningDelta,
  parseOpenAiCompatUsage
} from '@main/agent/providers/openai'
import type { ProviderChatRequest } from '@main/agent/providers/types'

describe('compatStreamOptions', () => {
  it('includes usage by default', () => {
    expect(compatStreamOptions({ defaultBaseUrl: 'https://api.openai.com/v1' })).toEqual({
      stream_options: { include_usage: true }
    })
  })

  it('omits stream_options for Mistral and Ollama', () => {
    expect(
      compatStreamOptions({ defaultBaseUrl: 'https://api.mistral.ai/v1', includeUsage: false })
    ).toEqual({})
    expect(
      compatStreamOptions({ defaultBaseUrl: 'http://127.0.0.1:11434/v1', ollamaVision: true })
    ).toEqual({})
  })
})

describe('buildOpenAiCompatBody prompt cache', () => {
  const baseReq: ProviderChatRequest = {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    signal: new AbortController().signal
  }

  it('omits max_tokens when maxOutputTokens is unset', () => {
    const body = buildOpenAiCompatBody(baseReq, { defaultBaseUrl: 'https://openrouter.ai/api/v1' })
    expect(body.max_tokens).toBeUndefined()
  })

  it('includes max_tokens only when explicitly set on the request', () => {
    const body = buildOpenAiCompatBody(
      { ...baseReq, maxOutputTokens: 4096 },
      { defaultBaseUrl: 'https://openrouter.ai/api/v1' }
    )
    expect(body.max_tokens).toBe(4096)
  })

  it('includes prompt_cache_key when enabled for OpenAI', () => {
    const body = buildOpenAiCompatBody(
      { ...baseReq, promptCacheKey: 'run-abc' },
      { defaultBaseUrl: 'https://api.openai.com/v1', enablePromptCache: true }
    )
    expect(body.prompt_cache_key).toBe('run-abc')
  })

  it('omits prompt_cache_key for providers without enablePromptCache', () => {
    const body = buildOpenAiCompatBody(
      { ...baseReq, promptCacheKey: 'run-abc' },
      { defaultBaseUrl: 'https://api.groq.com/openai/v1' }
    )
    expect(body.prompt_cache_key).toBeUndefined()
  })

  it('omits prompt_cache_key for DeepSeek (automatic prefix cache only)', () => {
    const body = buildOpenAiCompatBody(
      { ...baseReq, promptCacheKey: 'run-abc' },
      { defaultBaseUrl: 'https://api.deepseek.com/v1' }
    )
    expect(body.prompt_cache_key).toBeUndefined()
  })
})

describe('parseOpenAiCompatUsage cache metrics', () => {
  it('reads DeepSeek prompt_cache_hit_tokens', () => {
    const usage = parseOpenAiCompatUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_cache_hit_tokens: 900,
      prompt_cache_miss_tokens: 100
    })
    expect(usage?.cachedInputTokens).toBe(900)
    expect(usage?.inputTokens).toBe(1000)
  })

  it('reads Groq/OpenAI prompt_tokens_details.cached_tokens', () => {
    const usage = parseOpenAiCompatUsage({
      prompt_tokens: 500,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 400 }
    })
    expect(usage?.cachedInputTokens).toBe(400)
  })

  it('returns undefined for empty usage payloads', () => {
    expect(parseOpenAiCompatUsage(null)).toBeUndefined()
    expect(parseOpenAiCompatUsage({})).toBeUndefined()
  })
})

describe('openAiCompatMessageReasoningDelta', () => {
  it('emits the full message when no reasoning streamed yet', () => {
    expect(openAiCompatMessageReasoningDelta('Plan the audit.', '')).toBe('Plan the audit.')
  })

  it('emits only the new suffix when message extends streamed reasoning', () => {
    expect(openAiCompatMessageReasoningDelta('Plan the audit. Start with src.', 'Plan the audit.')).toBe(
      ' Start with src.'
    )
  })

  it('returns null when message does not extend accumulated reasoning', () => {
    expect(openAiCompatMessageReasoningDelta('Plan the audit.', 'Plan the audit.')).toBeNull()
  })
})
