import { useEffect, useMemo } from 'react'
import { PROVIDER_DEFAULTS, seedModelsFor, providerLabel } from '@shared/providers'
import type { ProviderId } from '@shared/ipc'
import { modelSelectionKey } from '@shared/domain/modelSelection'
import {
  filterModelsForWorkspace,
  modelsToOptions,
  seedOptionsForProvider,
  buildModelMetaMap,
  type ModelFilterOpts,
  type ModelPickerOption
} from './composerModelUtils'
import { useProviderCatalogCache } from './useProviderCatalogCache'

export function useComposerModels({
  provider,
  model,
  ollamaBaseUrl,
  modelsRefreshKey,
  hasWorkspace,
  hasImages,
  browsedProvider
}: {
  provider: ProviderId
  model: string
  ollamaBaseUrl?: string
  modelsRefreshKey?: string | number
  hasWorkspace?: boolean
  hasImages: boolean
  running?: boolean
  browsedProvider?: ProviderId
}) {
  const value = modelSelectionKey(provider, model)
  const activeBrowse = browsedProvider ?? provider

  const { cache, loadProvider, getEntry } = useProviderCatalogCache(
    ollamaBaseUrl,
    modelsRefreshKey
  )

  const filterOpts: ModelFilterOpts = useMemo(
    () => ({ hasWorkspace: Boolean(hasWorkspace), hasImages }),
    [hasWorkspace, hasImages]
  )

  useEffect(() => {
    void loadProvider(provider)
  }, [provider, modelsRefreshKey, loadProvider])

  useEffect(() => {
    if (activeBrowse !== provider) {
      void loadProvider(activeBrowse)
    }
  }, [activeBrowse, provider, loadProvider])

  const activeEntry = getEntry(provider)
  const liveModels = activeEntry?.models ?? null
  const modelsWarning = activeEntry?.warning ?? null

  const catalog =
    liveModels && liveModels.length > 0 ? liveModels : seedModelsFor(provider)
  const filtered = filterModelsForWorkspace(catalog, filterOpts)

  const optionsByProvider = useMemo(() => {
    const map = {} as Record<ProviderId, ModelPickerOption[]>
    for (const p of PROVIDER_DEFAULTS) {
      const label = p.label
      const entry = getEntry(p.id)
      const live = entry?.models
      if (live?.length) {
        const source = filterModelsForWorkspace(live, filterOpts)
        map[p.id] = modelsToOptions(p.id, source.length ? source : live, label)
      } else {
        const seeds = seedModelsFor(p.id)
        const seedFiltered = filterModelsForWorkspace(seeds, filterOpts)
        map[p.id] = modelsToOptions(
          p.id,
          seedFiltered.length ? seedFiltered : seeds,
          label
        )
      }
    }
    return map
  }, [cache, filterOpts, getEntry])

  const modelMetaByValue = useMemo(
    () => buildModelMetaMap(optionsByProvider),
    [optionsByProvider]
  )

  const seedsByProvider = useMemo(() => {
    const map = {} as Record<ProviderId, ModelPickerOption[]>
    for (const p of PROVIDER_DEFAULTS) {
      map[p.id] = seedOptionsForProvider(p.id)
    }
    return map
  }, [])

  const currentMeta = modelMetaByValue[value]

  const refreshCatalog = async (opts?: {
    forceRefresh?: boolean
    provider?: ProviderId
  }) => {
    const target = opts?.provider ?? activeBrowse
    const entry = await loadProvider(target, { forceRefresh: opts?.forceRefresh })
    return entry.models
      ? { ok: true as const, models: entry.models, warning: entry.warning }
      : { ok: false as const, error: entry.warning ?? 'Failed to load models' }
  }

  return {
    providers: PROVIDER_DEFAULTS.map((p) => p.id),
    optionsByProvider,
    seedsByProvider,
    modelMetaByValue,
    value,
    provider,
    model,
    providerLabel: providerLabel(provider),
    modelsWarning,
    catalogLoading: Boolean(getEntry(activeBrowse)?.loading),
    catalog,
    filtered,
    filterOpts,
    currentMeta,
    refreshCatalog,
    loadProvider
  }
}
