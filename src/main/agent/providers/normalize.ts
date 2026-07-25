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
    inputModalities: partial?.inputModalities ?? (supportsVision ? ['text', 'image'] : ['text']),
    outputModalities: partial?.outputModalities ?? ['text'],
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
          inputModalities: (inputMods?.filter((m) =>
            ['text', 'image', 'audio', 'file'].includes(m)
          ) as ModelInfo['inputModalities']) ?? (supportsVision ? ['text', 'image'] : ['text']),
          outputModalities: (outputMods?.filter((m) => ['text', 'image'].includes(m)) as ModelInfo['outputModalities']) ?? [
            'text'
          ],
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
