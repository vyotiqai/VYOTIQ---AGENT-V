import type { ModelInfo, ProviderId } from '../../../shared/ipc'
import { formatError } from '../../../shared/errors'
import { withResolvedContextWindow } from '../../../shared/domain/modelContextWindows'
import { providerLabel, providerNeedsKey, seedModelsFor } from '../../../shared/providers'
import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import {
  clearModelCacheKey,
  getCachedModels,
  modelCacheKey,
  setCachedModels
} from './modelCache'
import {
  deepseekProvider,
  groqProvider,
  mistralProvider,
  ollamaProvider,
  openaiProvider,
  openrouterProvider,
  xaiProvider
} from './openai'
import type { ListModelsRequest, LlmProvider } from './types'

const providers: Record<ProviderId, LlmProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
  deepseek: deepseekProvider,
  groq: groqProvider,
  openrouter: openrouterProvider,
  xai: xaiProvider,
  mistral: mistralProvider
}

export function getProvider(id: ProviderId): LlmProvider {
  return providers[id]
}

/** Map catalog failures into provider-aware, actionable warnings. */
export function catalogWarningMessage(provider: ProviderId, err: unknown): string {
  const label = providerLabel(provider)
  const raw = formatError(err)

  if (/API key not set/i.test(raw)) {
    return `${raw} Save a key in Providers settings, then refresh.`
  }

  if (/HTTP 401/i.test(raw)) {
    // DeepSeek (and some gateways) return this exact body when Authorization is missing/invalid.
    if (/Authentication Fails \(governor\)/i.test(raw)) {
      return `${label} returned HTTP 401 Authentication Fails (governor) — usually a missing or invalid API key. Save a valid ${label} key in Providers, then refresh.`
    }
    return `${label} returned HTTP 401 (unauthorized). Check the saved API key, then refresh.`
  }

  if (/HTTP 403/i.test(raw)) {
    return `${label} returned HTTP 403 (forbidden). Check the API key permissions.`
  }

  if (/Cannot reach Ollama|returned no models/i.test(raw)) {
    return `${raw} Showing seed defaults (not live models).`
  }

  return `${label}: ${raw}. Showing seed defaults (not live models).`
}

function enrichCatalogModels(provider: ProviderId, models: ModelInfo[]): ModelInfo[] {
  return models.map((m) => withResolvedContextWindow(m, provider))
}

export async function listProviderModels(input: {
  provider: ProviderId
  apiKey?: string | null
  baseUrl?: string
  signal?: AbortSignal
  forceRefresh?: boolean
}): Promise<{ models: ModelInfo[]; warning?: string }> {
  const key = modelCacheKey(input.provider, input.baseUrl, input.apiKey)
  if (!input.forceRefresh) {
    const cached = getCachedModels(key)
    if (cached) return { models: enrichCatalogModels(input.provider, cached) }
  }

  if (providerNeedsKey(input.provider) && !input.apiKey?.trim()) {
    const seeds = seedModelsFor(input.provider)
    return {
      models: enrichCatalogModels(input.provider, seeds),
      warning: catalogWarningMessage(
        input.provider,
        new Error(`${providerLabel(input.provider)} API key not set`)
      )
    }
  }

  const provider = getProvider(input.provider)
  const timeout = AbortSignal.timeout(10_000)
  const signal =
    input.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([input.signal, timeout])
      : input.signal ?? timeout
  const req: ListModelsRequest = {
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    signal
  }

  try {
    const models = await provider.listModels(req)
    if (!models.length) {
      if (input.forceRefresh) clearModelCacheKey(key)
      const seeds = seedModelsFor(input.provider)
      return {
        models: enrichCatalogModels(input.provider, seeds),
        warning: `${providerLabel(input.provider)} live catalog was empty; showing seed defaults (not installed models).`
      }
    }
    const enriched = enrichCatalogModels(input.provider, models)
    setCachedModels(key, enriched)
    return { models: enriched }
  } catch (err) {
    if (input.forceRefresh) clearModelCacheKey(key)
    const seeds = seedModelsFor(input.provider)
    const raw = formatError(err)
    const providerAlreadyExplained = /Cannot reach Ollama|returned no models|HTTP \d+|API key not set/i.test(
      raw
    )
    const timedOut =
      !providerAlreadyExplained &&
      (raw === 'Request timed out' ||
        raw === 'Request aborted' ||
        (timeout.aborted && /abort|timed out/i.test(raw)))
    if (timedOut) {
      return {
        models: enrichCatalogModels(input.provider, seeds),
        warning: `Timed out after 10s reaching ${providerLabel(input.provider)}${
          input.baseUrl ? ` at ${normalizeHostForWarning(input.baseUrl)}` : ''
        }. Showing seed defaults (not live models).`
      }
    }
    return {
      models: enrichCatalogModels(input.provider, seeds),
      warning: catalogWarningMessage(input.provider, err)
    }
  }
}

function normalizeHostForWarning(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/i, '').replace(/\/$/, '')
}

export type { LlmProvider, StreamChunk, ToolCall, ProviderChatRequest, TokenUsage } from './types'
