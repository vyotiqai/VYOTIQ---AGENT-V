import { getSecret } from '@main/settings/secrets'
import { getSettings } from '@main/settings/settings'
import { normalizeCustomOpenAiBaseUrl } from '../../../../shared/domain/providers'
import {
  ensureCustomImageSupported
} from './customProbe'
import { geminiImageAdapter } from './gemini'
import { customImageAdapter, openaiImageAdapter } from './openai'
import { openrouterImageAdapter } from './openrouter'
import { xaiImageAdapter } from './xai'
import {
  DEFAULT_IMAGE_MODELS,
  IMAGE_GEN_PROVIDERS,
  type ImageEditRequest,
  type ImageGenAdapter,
  type ImageGenProviderId,
  type ImageGenRequest,
  type ImageGenResult
} from './types'

export * from './types'
export { openaiImageAdapter, customImageAdapter, createOpenAiImageAdapter } from './openai'
export { geminiImageAdapter } from './gemini'
export { xaiImageAdapter } from './xai'
export { openrouterImageAdapter } from './openrouter'
export { validateOpenAiImageSize, parseOpenAiSizeWxH } from './openaiSize'
export { applyImagePreset, resolveModelWithPresetHint, type ImagePreset } from './presets'
export { mimeForOutputFormat, extForMime, normalizeOutputFormat } from './mime'
export { normalizeGeminiImageSize } from './gemini'
export { normalizeXaiResolution } from './xai'
export {
  listOpenRouterImageModels,
  lookupOpenRouterImageModel,
  clearOpenRouterImageDiscoveryCache
} from './openrouterDiscovery'
export {
  mapOpenRouterImageError,
  parseOpenRouterImageResponse
} from './openrouter'
export {
  probeCustomImageGenerations,
  ensureCustomImageSupported,
  clearCustomImageProbeCache,
  classifyCustomImageHttpStatus,
  getCachedCustomImageProbe,
  generationsUrl,
  editsUrl
} from './customProbe'

const ADAPTERS: Record<ImageGenProviderId, ImageGenAdapter> = {
  openai: openaiImageAdapter,
  gemini: geminiImageAdapter,
  xai: xaiImageAdapter,
  openrouter: openrouterImageAdapter,
  custom: customImageAdapter
}

export function isImageGenProviderId(value: string): value is ImageGenProviderId {
  return (IMAGE_GEN_PROVIDERS as readonly string[]).includes(value)
}

/** Preferred order when settings say auto. Custom last (explicit enable + probe). */
const AUTO_PRIORITY: ImageGenProviderId[] = [
  'openai',
  'gemini',
  'xai',
  'openrouter',
  'custom'
]

export function resolveImageGenProvider(opts: {
  explicit?: string | null
  settingsProvider?: string | null
  /** When true, prefer matching the active chat provider if it is image-capable. */
  chatProvider?: string | null
  hasKey: (id: ImageGenProviderId) => boolean
}): { providerId: ImageGenProviderId } | { error: string } {
  const tryId = (raw: string | null | undefined): ImageGenProviderId | null => {
    if (!raw || raw === 'auto') return null
    const id = raw.trim().toLowerCase()
    return isImageGenProviderId(id) ? id : null
  }

  const explicit = tryId(opts.explicit)
  if (explicit) {
    if (!opts.hasKey(explicit)) {
      if (explicit === 'custom') {
        return {
          error:
            'Custom image provider is not available. Enable “Enable image generation on custom host” in Settings → Agent, set Custom OpenAI base URL, and save a Custom API key.'
        }
      }
      return {
        error: `No API key configured for image provider "${explicit}". Add it in Settings → Providers.`
      }
    }
    return { providerId: explicit }
  }

  const fromSettings = tryId(opts.settingsProvider)
  if (fromSettings) {
    if (!opts.hasKey(fromSettings)) {
      if (fromSettings === 'custom') {
        return {
          error:
            'Image provider is set to “custom” but custom images are disabled or the Custom API key/base URL is missing.'
        }
      }
      return {
        error: `Image provider is set to "${fromSettings}" but its API key is missing. Add the key or change Image provider in Settings.`
      }
    }
    return { providerId: fromSettings }
  }

  const chat = tryId(opts.chatProvider)
  if (chat && opts.hasKey(chat)) return { providerId: chat }

  for (const id of AUTO_PRIORITY) {
    if (opts.hasKey(id)) return { providerId: id }
  }

  return {
    error:
      'No image-capable API key configured. Add an OpenAI, Gemini, xAI, or OpenRouter key — or enable custom host images — in Settings.'
  }
}

export function resolveImageModel(
  providerId: ImageGenProviderId,
  explicitModel?: string | null,
  settingsModel?: string | null
): string {
  const explicit = explicitModel?.trim()
  if (explicit) return explicit
  const fromSettings = settingsModel?.trim()
  if (fromSettings) return fromSettings
  return DEFAULT_IMAGE_MODELS[providerId]
}

function resolveCustomBaseUrl(reqBase?: string | null): string {
  if (reqBase?.trim()) return normalizeCustomOpenAiBaseUrl(reqBase)
  const settings = getSettings()
  return normalizeCustomOpenAiBaseUrl(settings.customOpenAiBaseUrl)
}

function withCustomRequestFields<T extends ImageGenRequest>(
  providerId: ImageGenProviderId,
  req: T
): T {
  if (providerId !== 'custom') return req
  return {
    ...req,
    openAiBaseUrl: resolveCustomBaseUrl(req.openAiBaseUrl),
    openAiCompatMode: true
  }
}

export async function generateImageBytes(
  providerId: ImageGenProviderId,
  apiKey: string,
  req: Omit<ImageGenRequest, 'model'> & { model?: string },
  settingsModel?: string | null
): Promise<ImageGenResult & { providerId: ImageGenProviderId; model: string }> {
  const model = resolveImageModel(providerId, req.model, settingsModel)
  const fullReq = withCustomRequestFields(providerId, { ...req, model })

  if (providerId === 'custom') {
    const gate = await ensureCustomImageSupported(apiKey, fullReq.openAiBaseUrl!, {
      signal: fullReq.signal,
      model
    })
    if (!gate.ok) return { ...gate, providerId, model }
  }

  const adapter = ADAPTERS[providerId]
  const result = await adapter.generate(apiKey, fullReq)
  return { ...result, providerId, model }
}

export async function editImageBytes(
  providerId: ImageGenProviderId,
  apiKey: string,
  req: Omit<ImageEditRequest, 'model'> & { model?: string },
  settingsModel?: string | null
): Promise<ImageGenResult & { providerId: ImageGenProviderId; model: string }> {
  const model = resolveImageModel(providerId, req.model, settingsModel)
  const fullReq = withCustomRequestFields(providerId, { ...req, model })

  if (providerId === 'custom') {
    const gate = await ensureCustomImageSupported(apiKey, fullReq.openAiBaseUrl!, {
      signal: fullReq.signal,
      model
    })
    if (!gate.ok) return { ...gate, providerId, model }
  }

  const adapter = ADAPTERS[providerId]
  const result = await adapter.edit(apiKey, fullReq)
  return { ...result, providerId, model }
}

/**
 * Live secret lookup used by the tool.
 * `custom` also requires Settings `customImageEnabled` (chat-compat ≠ image-compat).
 */
export function hasImageGenKey(providerId: ImageGenProviderId): boolean {
  if (providerId === 'custom') {
    const settings = getSettings()
    if (!settings.customImageEnabled) return false
    if (!settings.customOpenAiBaseUrl?.trim()) return false
    return Boolean(getSecret('custom')?.trim())
  }
  return Boolean(getSecret(providerId)?.trim())
}

export function getImageGenKey(providerId: ImageGenProviderId): string | null {
  if (providerId === 'custom') {
    if (!hasImageGenKey('custom')) return null
    return getSecret('custom')?.trim() || null
  }
  const key = getSecret(providerId)?.trim()
  return key || null
}
