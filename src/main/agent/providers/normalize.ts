import type { ModelInfo, ProviderId } from '../../../shared/ipc'
import { modelSupportsThinking, thinkingApiFor } from '../../../shared/reasoning'
import { inferSupportedServiceTiers } from '../../../shared/domain/serviceTier'

const NON_CHAT =
  /embed|embedding|tts|whisper|dall-e|dalle|imagen|veo|imagine|moderation|transcribe|realtime|audio|video|coding\.|computer-use/i

export function looksLikeChatModel(id: string): boolean {
  return !NON_CHAT.test(id)
}

export function idSuggestsVision(id: string): boolean {
  return /gpt-4o|gpt-5|vision|llava|llama3\.2-vision|llama3\.2:vision|claude|gemini|grok|pixtral|mistral-small|mistral-medium|mistral-large|bakllava|moondream/i.test(
    id
  )
}

/**
 * Modalities we can actually send on the wire for a provider.
 * Catalog APIs may advertise more; keep only what mappers implement.
 */
export function wireSupportedInputModalities(
  mods: readonly string[] | undefined,
  supportsVision: boolean,
  providerId?: ProviderId
): ModelInfo['inputModalities'] {
  const caps = wireCapsForProvider(providerId)
  const fromCatalog = (mods ?? []).filter(
    (m): m is 'text' | 'image' | 'audio' | 'file' =>
      m === 'text' || m === 'image' || m === 'audio' || m === 'file'
  )
  const kept: Array<'text' | 'image' | 'audio' | 'file'> = []
  if (fromCatalog.includes('text') || fromCatalog.length === 0) kept.push('text')
  if (supportsVision && caps.image) {
    if (fromCatalog.length === 0 || fromCatalog.includes('image')) kept.push('image')
  }
  if (caps.audio && fromCatalog.includes('audio')) kept.push('audio')
  if (caps.fileNative && (fromCatalog.includes('file') || providerAllowsNativeFileDefault(providerId))) {
    if (!kept.includes('file')) kept.push('file')
  }
  if (kept.length === 0) return supportsVision && caps.image ? ['text', 'image'] : ['text']
  return kept
}

function providerAllowsNativeFileDefault(providerId?: ProviderId): boolean {
  // Anthropic / Gemini / OpenAI Responses advertise file when wire path exists even if
  // the catalog list omitted it — still require explicit catalog audio.
  return providerId === 'anthropic' || providerId === 'gemini' || providerId === 'openai'
}

export function wireCapsForProvider(providerId?: ProviderId): {
  image: boolean
  audio: boolean
  fileNative: boolean
} {
  switch (providerId) {
    case 'anthropic':
      return { image: true, audio: false, fileNative: true }
    case 'gemini':
      return { image: true, audio: true, fileNative: true }
    case 'openai':
      // Chat Completions: audio when catalog lists it; native file via Responses path.
      return { image: true, audio: true, fileNative: true }
    case 'ollama':
    case 'mistral':
      return { image: true, audio: false, fileNative: false }
    default:
      return { image: true, audio: false, fileNative: false }
  }
}

/** Output is text-only in this app (no image generation path). */
export function wireSupportedOutputModalities(
  mods: readonly string[] | undefined
): ModelInfo['outputModalities'] {
  const kept = (mods ?? []).filter((m): m is 'text' => m === 'text')
  return kept.length > 0 ? kept : ['text']
}

export function inferStructuredOutputSupport(id: string, providerId?: ProviderId): boolean {
  if (providerId === 'ollama') {
    return /json|qwen2\.5|llama3|mistral|deepseek/i.test(id)
  }
  return looksLikeChatModel(id)
}

export function baseModelInfo(
  id: string,
  partial?: Partial<ModelInfo>,
  providerId?: ProviderId
): ModelInfo {
  const supportsVision = partial?.supportsVision ?? idSuggestsVision(id)
  const supportsThinking = partial?.supportsThinking ?? modelSupportsThinking(id, providerId)
  const supportedServiceTiers =
    partial?.supportedServiceTiers ?? inferSupportedServiceTiers(id, providerId)
  return {
    id,
    displayName: partial?.displayName ?? id,
    contextWindow: partial?.contextWindow,
    maxOutputTokens: partial?.maxOutputTokens,
    inputModalities: wireSupportedInputModalities(
      partial?.inputModalities,
      supportsVision,
      providerId
    ),
    outputModalities: wireSupportedOutputModalities(partial?.outputModalities),
    supportsTools: partial?.supportsTools ?? looksLikeChatModel(id),
    supportsVision,
    supportsStructuredOutput:
      partial?.supportsStructuredOutput ?? inferStructuredOutputSupport(id, providerId),
    supportsThinking,
    thinkingApi: partial?.thinkingApi ?? (providerId ? thinkingApiFor(id, providerId) : undefined),
    supportedServiceTiers:
      supportedServiceTiers.length > 0 ? supportedServiceTiers : undefined
  }
}

export function normalizeOpenAiStyleModels(
  data: unknown,
  opts?: { requireToolsParam?: boolean; providerId?: ProviderId }
): ModelInfo[] {
  const root = data as { data?: unknown[] }
  const list = Array.isArray(root?.data) ? root.data : Array.isArray(data) ? data : []
  const out: ModelInfo[] = []
  const providerId = opts?.providerId

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : typeof row.name === 'string' ? row.name : null
    if (!id || !looksLikeChatModel(id)) continue

    const supported = row.supported_parameters
    const supportedParams = Array.isArray(supported) ? (supported as string[]) : undefined
    if (opts?.requireToolsParam && supportedParams && !supportedParams.includes('tools')) {
      continue
    }

    const arch = row.architecture as Record<string, unknown> | undefined
    const inputMods = Array.isArray(arch?.input_modalities)
      ? (arch.input_modalities as string[])
      : Array.isArray(row.input_modalities)
        ? (row.input_modalities as string[])
        : undefined
    const outputMods = Array.isArray(arch?.output_modalities)
      ? (arch.output_modalities as string[])
      : Array.isArray(row.output_modalities)
        ? (row.output_modalities as string[])
        : undefined

    const supportsVision = inputMods
      ? inputMods.includes('image')
      : idSuggestsVision(id)
    const supportsTools = supportedParams
      ? supportedParams.includes('tools')
      : looksLikeChatModel(id)

    const contextWindow =
      typeof row.context_length === 'number'
        ? row.context_length
        : typeof row.context_window === 'number'
          ? row.context_window
          : undefined

    const serviceTiers = inferSupportedServiceTiers(id, providerId, supportedParams)

    out.push(
      baseModelInfo(
        id,
        {
          displayName: typeof row.name === 'string' ? row.name : id,
          contextWindow,
          maxOutputTokens:
            typeof row.max_output_tokens === 'number' ? row.max_output_tokens : undefined,
          inputModalities: wireSupportedInputModalities(inputMods, supportsVision, providerId),
          outputModalities: wireSupportedOutputModalities(outputMods),
          supportsTools,
          supportsVision,
          supportedServiceTiers: serviceTiers.length > 0 ? serviceTiers : undefined
        },
        providerId
      )
    )
  }

  return out
}

export function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(url)
  if (!m) return null
  return { mediaType: m[1], data: m[2] }
}
