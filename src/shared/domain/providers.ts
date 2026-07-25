import type { ModelInfo, ProviderId } from '../ipc/schemas/providers'

export type ProviderDefault = {
  id: ProviderId
  label: string
  models: string[]
}

const SEED_MODEL_IDS: Record<ProviderId, string[]> = {
  openai: ['gpt-4o', 'gpt-4.1', 'o3-mini'],
  anthropic: ['claude-sonnet-4', 'claude-haiku-4-5'],
  gemini: ['gemini-2.0-flash', 'gemini-2.5-pro-preview'],
  ollama: ['qwen2.5', 'llama3.2', 'deepseek-r1'],
  deepseek: ['deepseek-v3', 'deepseek-reasoner'],
  groq: ['llama-3.3-70b-versatile'],
  openrouter: ['openrouter/auto'],
  xai: ['grok-2-latest'],
  mistral: ['mistral-large-latest']
}

function seedModelInfo(id: string, providerId: ProviderId): ModelInfo {
  const supportsVision = /gpt-4o|gpt-5|claude|gemini|grok|llava|vision|pixtral/i.test(id)
  const supportsThinking = /reasoner|r1|o3|thinking/i.test(id)
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
    contextWindow: providerId === 'ollama' ? 32_768 : 128_000
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

export function providerNeedsKey(provider: ProviderId): boolean {
  return provider !== 'ollama'
}

export function normalizeOllamaHost(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return 'http://127.0.0.1:11434'
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`
  return trimmed
}

export function ollamaOpenAiBaseUrl(url: string): string {
  return `${normalizeOllamaHost(url)}/v1`
}

export function resolveOllamaListBaseUrl(reqBase?: string, settingsBase?: string): string {
  return normalizeOllamaHost(reqBase ?? settingsBase ?? 'http://127.0.0.1:11434')
}
