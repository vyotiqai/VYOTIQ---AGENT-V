import type { ModelInfo, ProviderId } from '../ipc/schemas/providers'
import { knownContextWindow } from './modelContextWindows'
import { modelSupportsThinking, thinkingApiFor } from '../reasoning'

export type ProviderDefault = {
  id: ProviderId
  label: string
  models: string[]
}

const SEED_MODEL_IDS: Record<ProviderId, string[]> = {
  openai: ['gpt-4o', 'gpt-4.1', 'o3-mini'],
  anthropic: ['claude-sonnet-4', 'claude-haiku-4-5'],
  gemini: ['gemini-2.0-flash', 'gemini-2.5-pro-preview'],
  ollama: ['qwen2.5', 'llama3.2', 'deepseek-r1', 'gpt-oss:120b', 'deepseek-v4-flash'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-reasoner'],
  groq: ['llama-3.3-70b-versatile'],
  openrouter: ['openrouter/auto'],
  xai: ['grok-2-latest'],
  mistral: ['mistral-large-latest']
}

function seedModelInfo(id: string, providerId: ProviderId): ModelInfo {
  const supportsVision = /gpt-4o|gpt-5|claude|gemini|grok|llava|vision|pixtral/i.test(id)
  const supportsThinking = modelSupportsThinking(id, providerId)
  const known = knownContextWindow(id, providerId)
  return {
    id,
    displayName: id,
    inputModalities: supportsVision ? ['text', 'image'] : ['text'],
    outputModalities: ['text'],
    supportsTools: true,
    supportsVision,
    supportsStructuredOutput:
      providerId === 'ollama' ? /json|qwen|llama|deepseek/i.test(id) : true,
    supportsThinking,
    thinkingApi: supportsThinking ? thinkingApiFor(id, providerId) : undefined,
    contextWindow: known ?? (providerId === 'ollama' ? 32_768 : 128_000)
  }
}

export const PROVIDER_DEFAULTS: ProviderDefault[] = [
  { id: 'openai', label: 'OpenAI', models: SEED_MODEL_IDS.openai },
  { id: 'anthropic', label: 'Anthropic', models: SEED_MODEL_IDS.anthropic },
  { id: 'gemini', label: 'Gemini', models: SEED_MODEL_IDS.gemini },
  { id: 'ollama', label: 'Ollama', models: SEED_MODEL_IDS.ollama },
  { id: 'deepseek', label: 'DeepSeek', models: SEED_MODEL_IDS.deepseek },
  { id: 'groq', label: 'Groq', models: SEED_MODEL_IDS.groq },
  { id: 'openrouter', label: 'OpenRouter', models: SEED_MODEL_IDS.openrouter },
  { id: 'xai', label: 'xAI', models: SEED_MODEL_IDS.xai },
  { id: 'mistral', label: 'Mistral', models: SEED_MODEL_IDS.mistral }
]

export function seedModelsFor(provider: ProviderId): ModelInfo[] {
  return SEED_MODEL_IDS[provider].map((id) => seedModelInfo(id, provider))
}

export function defaultModelFor(provider: ProviderId): string {
  return SEED_MODEL_IDS[provider][0]!
}

export function providerLabel(provider: ProviderId): string {
  return PROVIDER_DEFAULTS.find((entry) => entry.id === provider)?.label ?? provider
}

/**
 * Whether a provider requires an API key for live catalog/chat.
 * Local Ollama does not; Ollama Cloud (`ollama.com`) does.
 */
export function providerNeedsKey(provider: ProviderId, baseUrl?: string): boolean {
  if (provider !== 'ollama') return true
  return isOllamaCloudHost(baseUrl ?? '')
}

export function normalizeOllamaHost(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return 'http://127.0.0.1:11434'
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`
  return trimmed
}

/** Native Ollama host (no trailing `/v1`) — safe to append `/v1` or `/api/...`. */
export function ollamaNativeHost(url: string): string {
  return normalizeOllamaHost(url).replace(/\/v1$/i, '')
}

/** True when the host is Ollama's cloud API (`ollama.com`). */
export function isOllamaCloudHost(url: string): boolean {
  try {
    const hostname = new URL(ollamaNativeHost(url || 'http://127.0.0.1:11434')).hostname.toLowerCase()
    return hostname === 'ollama.com' || hostname.endsWith('.ollama.com')
  } catch {
    return false
  }
}

export function ollamaOpenAiBaseUrl(url: string): string {
  return `${ollamaNativeHost(url)}/v1`
}

export function resolveOllamaListBaseUrl(reqBase?: string, settingsBase?: string): string {
  return ollamaNativeHost(reqBase ?? settingsBase ?? 'http://127.0.0.1:11434')
}
