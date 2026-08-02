import type { ModelInfo, ProviderId } from '../ipc/schemas/providers'
import { knownContextWindow } from './modelContextWindows'
import { modelSupportsThinking, thinkingApiFor } from '../reasoning'

export type ProviderDefault = {
  id: ProviderId
  label: string
  models: string[]
}

const SEED_MODEL_IDS: Record<ProviderId, string[]> = {
  openai: ['gpt-5.6', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  anthropic: ['claude-opus-5', 'claude-sonnet-4', 'claude-haiku-4-5'],
  gemini: ['gemini-3.6-flash', 'gemini-2.5-pro'],
  ollama: ['qwen2.5', 'llama3.2', 'deepseek-r1', 'gpt-oss:120b', 'deepseek-v4-flash'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  groq: ['llama-4-scout-17b-16e-instruct'],
  openrouter: ['openrouter/auto'],
  xai: ['grok-4-latest'],
  mistral: ['mistral-large-latest'],
  custom: ['gpt-oss-120b', 'llama3.2', 'qwen2.5']
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
  { id: 'mistral', label: 'Mistral', models: SEED_MODEL_IDS.mistral },
  { id: 'custom', label: 'Custom OpenAI-compatible', models: SEED_MODEL_IDS.custom }
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

export const OLLAMA_LOCAL_DEFAULT = 'http://127.0.0.1:11434'
export const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com'
/** Default OpenAI-compatible gateway (local vLLM / llama.cpp / etc.). */
export const CUSTOM_OPENAI_DEFAULT = 'http://127.0.0.1:8080/v1'

/**
 * Whether a provider requires an API key for live catalog/chat.
 * Local Ollama and local custom OpenAI-compat hosts do not; cloud hosts do.
 */
export function providerNeedsKey(provider: ProviderId, baseUrl?: string): boolean {
  if (provider === 'ollama') return isOllamaCloudHost(baseUrl ?? '')
  if (provider === 'custom') {
    return !isLocalOllamaHost(normalizeCustomOpenAiBaseUrl(baseUrl ?? CUSTOM_OPENAI_DEFAULT))
  }
  return true
}

export function normalizeOllamaHost(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return OLLAMA_LOCAL_DEFAULT
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
    const hostname = new URL(ollamaNativeHost(url || OLLAMA_LOCAL_DEFAULT)).hostname.toLowerCase()
    return hostname === 'ollama.com' || hostname.endsWith('.ollama.com')
  } catch {
    return false
  }
}

/** Loopback / local daemon hosts (not a remote Ollama server). */
export function isLocalOllamaHost(url: string): boolean {
  try {
    const hostname = new URL(ollamaNativeHost(url || OLLAMA_LOCAL_DEFAULT)).hostname.toLowerCase()
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]'
    )
  } catch {
    return false
  }
}

/**
 * Route to Ollama Cloud when an API key is set and the configured URL is still local.
 * Explicit remote hosts (including cloud) are left unchanged.
 */
export function resolveEffectiveOllamaHost(
  configuredUrl: string | undefined,
  apiKey?: string | null
): string {
  const configured = ollamaNativeHost(configuredUrl ?? OLLAMA_LOCAL_DEFAULT)
  if (apiKey?.trim() && isLocalOllamaHost(configured)) {
    return OLLAMA_CLOUD_BASE_URL
  }
  return configured
}

export function ollamaOpenAiBaseUrl(url: string): string {
  return `${ollamaNativeHost(url)}/v1`
}

export function resolveOllamaListBaseUrl(
  reqBase?: string,
  settingsBase?: string,
  apiKey?: string | null
): string {
  return resolveEffectiveOllamaHost(reqBase ?? settingsBase ?? OLLAMA_LOCAL_DEFAULT, apiKey)
}

/**
 * Normalize a custom OpenAI-compatible base URL.
 * Ensures http(s) scheme and a trailing `/v1` (without doubling).
 */
export function normalizeCustomOpenAiBaseUrl(url: string): string {
  let trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return CUSTOM_OPENAI_DEFAULT
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `http://${trimmed}`
  if (!/\/v1$/i.test(trimmed)) trimmed = `${trimmed}/v1`
  return trimmed
}

type ProviderBaseUrlSettings = {
  ollamaBaseUrl?: string
  customOpenAiBaseUrl?: string
}

/** Chat / listModels base URL when the provider uses a configurable host. */
export function resolveProviderChatBaseUrl(
  providerId: ProviderId,
  settings: ProviderBaseUrlSettings,
  apiKey?: string | null
): string | undefined {
  if (providerId === 'ollama') {
    return ollamaOpenAiBaseUrl(resolveEffectiveOllamaHost(settings.ollamaBaseUrl, apiKey))
  }
  if (providerId === 'custom') {
    return normalizeCustomOpenAiBaseUrl(settings.customOpenAiBaseUrl ?? CUSTOM_OPENAI_DEFAULT)
  }
  return undefined
}

/** Catalog listModels base URL (native host for Ollama; `/v1` base for custom). */
export function resolveProviderListBaseUrl(
  providerId: ProviderId,
  reqBase: string | undefined,
  settings: ProviderBaseUrlSettings,
  apiKey?: string | null
): string | undefined {
  if (providerId === 'ollama') {
    return resolveOllamaListBaseUrl(reqBase, settings.ollamaBaseUrl, apiKey)
  }
  if (providerId === 'custom') {
    return normalizeCustomOpenAiBaseUrl(
      reqBase ?? settings.customOpenAiBaseUrl ?? CUSTOM_OPENAI_DEFAULT
    )
  }
  return reqBase
}
