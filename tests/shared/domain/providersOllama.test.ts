import { describe, expect, it } from 'vitest'
import {
  isOllamaCloudHost,
  ollamaNativeHost,
  ollamaOpenAiBaseUrl,
  providerNeedsKey,
  resolveOllamaListBaseUrl
} from '@shared/domain/providers'

describe('ollama host helpers', () => {
  it('strips trailing /v1 so OpenAI base is never doubled', () => {
    expect(ollamaNativeHost('https://ollama.com/v1')).toBe('https://ollama.com')
    expect(ollamaNativeHost('https://ollama.com/v1/')).toBe('https://ollama.com')
    expect(ollamaNativeHost('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434')
    expect(ollamaOpenAiBaseUrl('https://ollama.com/v1')).toBe('https://ollama.com/v1')
    expect(resolveOllamaListBaseUrl('https://ollama.com/v1')).toBe('https://ollama.com')
  })

  it('detects Ollama Cloud hosts', () => {
    expect(isOllamaCloudHost('https://ollama.com')).toBe(true)
    expect(isOllamaCloudHost('https://ollama.com/v1')).toBe(true)
    expect(isOllamaCloudHost('https://api.ollama.com')).toBe(true)
    expect(isOllamaCloudHost('http://127.0.0.1:11434')).toBe(false)
    expect(isOllamaCloudHost('http://localhost:11434')).toBe(false)
  })

  it('requires a key only for Ollama Cloud', () => {
    expect(providerNeedsKey('openai')).toBe(true)
    expect(providerNeedsKey('ollama')).toBe(false)
    expect(providerNeedsKey('ollama', 'http://127.0.0.1:11434')).toBe(false)
    expect(providerNeedsKey('ollama', 'https://ollama.com')).toBe(true)
  })
})
