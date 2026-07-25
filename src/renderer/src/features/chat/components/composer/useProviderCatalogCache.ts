import { useCallback, useRef, useState } from 'react'
import { ollamaOpenAiBaseUrl } from '@shared/providers'
import type { ModelInfo, ProviderId } from '@shared/ipc'

type CacheEntry = {
  models: ModelInfo[] | null
  warning: string | null
  loading: boolean
}

export function useProviderCatalogCache(
  ollamaBaseUrl?: string,
  modelsRefreshKey?: string | number
) {
  const [cache, setCache] = useState<Partial<Record<ProviderId, CacheEntry>>>({})
  const inflight = useRef(new Set<ProviderId>())

  const loadProvider = useCallback(
    async (provider: ProviderId, opts?: { forceRefresh?: boolean }) => {
      const existing = cache[provider]
      if (!opts?.forceRefresh && existing?.models && !existing.loading) {
        return existing
      }
      if (inflight.current.has(provider) && !opts?.forceRefresh) {
        return cache[provider] ?? { models: null, warning: null, loading: true }
      }

      inflight.current.add(provider)
      setCache((prev) => ({
        ...prev,
        [provider]: {
          models: prev[provider]?.models ?? null,
          warning: prev[provider]?.warning ?? null,
          loading: true
        }
      }))

      if (!window.vyotiq?.listModels) {
        inflight.current.delete(provider)
        const entry = { models: null, warning: 'Models API unavailable', loading: false }
        setCache((prev) => ({ ...prev, [provider]: entry }))
        return entry
      }

      const res = await window.vyotiq.listModels({
        provider,
        baseUrl:
          provider === 'ollama' && ollamaBaseUrl
            ? ollamaOpenAiBaseUrl(ollamaBaseUrl)
            : undefined,
        forceRefresh: opts?.forceRefresh
      })

      inflight.current.delete(provider)
      const entry: CacheEntry = res.ok
        ? {
            models: res.data.models,
            warning: res.data.warning ?? null,
            loading: false
          }
        : {
            models: null,
            warning: res.error,
            loading: false
          }
      setCache((prev) => ({ ...prev, [provider]: entry }))
      return entry
    },
    [cache, ollamaBaseUrl]
  )

  const getEntry = useCallback(
    (provider: ProviderId): CacheEntry | undefined => cache[provider],
    [cache]
  )

  return { cache, loadProvider, getEntry, modelsRefreshKey }
}
