import { PROVIDER_DEFAULTS, seedModelsFor, providerLabel } from '@shared/providers'
import type { ModelInfo, ProviderId } from '@shared/ipc'
import { modelSelectionKey, parseModelSelectionKey } from '@shared/domain/modelSelection'
import { inferSupportedServiceTiers } from '@shared/domain/serviceTier'

export type ModelFilterOpts = { hasWorkspace: boolean; hasImages: boolean }

export type ModelPickerOption = {
  value: string
  label: string
  group?: string
  subProvider?: string
  meta?: ModelInfo
}

const OPENROUTER_PREFIX_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  mistral: 'Mistral',
  meta: 'Meta',
  'meta-llama': 'Meta',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  'x-ai': 'xAI',
  arcee: 'Arcee AI',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  microsoft: 'Microsoft',
  nvidia: 'NVIDIA'
}

export function openRouterGroup(modelId: string): string {
  const prefix = modelId.split('/')[0]?.toLowerCase() ?? ''
  return OPENROUTER_PREFIX_LABELS[prefix] ?? capitalize(prefix.replace(/-/g, ' '))
}

export function openRouterSubProvider(modelId: string): string | undefined {
  if (!modelId.includes('/')) return undefined
  return modelId.split('/')[0]?.toLowerCase()
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatModelDisplayName(id: string, displayName?: string): string {
  const name = displayName ?? id
  if (id.includes('/') && name === id) {
    const part = id.slice(id.lastIndexOf('/') + 1)
    return part.replace(/-/g, ' ')
  }
  return name
}

export function filterModelsForWorkspace<T extends ModelInfo>(
  models: T[],
  opts: ModelFilterOpts
): T[] {
  const { hasWorkspace, hasImages } = opts
  if (!hasWorkspace && !hasImages) return models
  return models.filter((model) => {
    if (hasWorkspace && !model.supportsTools) return false
    if (hasImages && !(model.supportsVision || model.inputModalities.includes('image'))) {
      return false
    }
    return true
  })
}

export function modelsToOptions(
  provider: ProviderId,
  models: ModelInfo[],
  providerLabel: string
): ModelPickerOption[] {
  return models.map((m) => {
    const group =
      provider === 'openrouter' && m.id.includes('/')
        ? openRouterGroup(m.id)
        : providerLabel
    return {
      value: modelSelectionKey(provider, m.id),
      label: formatModelDisplayName(m.id, m.displayName),
      group,
      subProvider: openRouterSubProvider(m.id),
      meta: m
    }
  })
}

export function seedOptionsForProvider(provider: ProviderId): ModelPickerOption[] {
  const label = PROVIDER_DEFAULTS.find((p) => p.id === provider)?.label ?? provider
  return modelsToOptions(provider, seedModelsFor(provider), label)
}

export function buildModelMetaMap(
  optionsByProvider: Record<string, ModelPickerOption[]>
): Record<string, ModelInfo> {
  const map: Record<string, ModelInfo> = {}
  for (const opts of Object.values(optionsByProvider)) {
    for (const opt of opts) {
      if (opt.meta) map[opt.value] = opt.meta
    }
  }
  return map
}

/** Resolve a stored model key to a picker row, including cross-provider favorites/recent. */
export function resolvePickerOption(
  key: string,
  optionsByProvider: Record<ProviderId, ModelPickerOption[]>,
  modelMetaByValue: Record<string, ModelInfo>
): ModelPickerOption | undefined {
  const parsed = parseModelSelectionKey(key)
  if (!parsed) return undefined
  const found = optionsByProvider[parsed.provider]?.find((o) => o.value === key)
  if (found) return found
  const meta = modelMetaByValue[key]
  const label = formatModelDisplayName(parsed.model, meta?.displayName)
  const group =
    parsed.provider === 'openrouter' && parsed.model.includes('/')
      ? openRouterGroup(parsed.model)
      : providerLabel(parsed.provider)
  return {
    value: key,
    label,
    group,
    subProvider: openRouterSubProvider(parsed.model),
    meta
  }
}

export function supportedTiersForModel(
  provider: ProviderId,
  modelId: string,
  meta?: ModelInfo
): import('@shared/ipc').ServiceTier[] {
  if (meta?.supportedServiceTiers?.length) return meta.supportedServiceTiers
  const tiers = inferSupportedServiceTiers(modelId, provider)
  return tiers.length > 0 ? tiers : []
}
