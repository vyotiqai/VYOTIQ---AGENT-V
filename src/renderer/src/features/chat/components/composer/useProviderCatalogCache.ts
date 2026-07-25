import { useCallback, useEffect, useRef, useState } from 'react'
import { ollamaOpenAiBaseUrl } from '@shared/providers'
import type { ModelInfo, ProviderId } from '@shared/ipc'

type CacheEntry = {
  models: ModelInfo[] | null
  warning: string | null
  loading: boolean
}

const UNAVAILABLE: CacheEntry = {
  models: null,
  warning: 'Models API unavailable',
  loading: false
}

export function useProviderCatalogCache(
  ollamaBaseUrl?: string,
  modelsRefreshKey?: string | number
) {
  const [cache, setCache] = useState<Partial<Record<ProviderId, CacheEntry>>>({})
  const cacheRef = useRef(cache)
  const inflight = useRef(new Map<ProviderId, Promise<CacheEntry>>())

  const write = useCallback((provider: ProviderId, entry: CacheEntry) => {
    cacheRef.current = { ...cacheRef.current, [provider]: entry }
    setCache(cacheRef.current)
  }, [])

  const loadProvider = useCallback(
    async (provider: ProviderId, opts?: { forceRefresh?: boolean }): Promise<CacheEntry> => {
      // A settled entry ends the load, success or failure. Retrying a failure here would
      // re-render, re-run the caller's effect, and spin forever.
      const existing = cacheRef.current[provider]
      if (!opts?.forceRefresh && existing && !existing.loading) return existing

      const pending = inflight.current.get(provider)
      if (pending && !opts?.forceRefresh) return pending

      const run = (async () => {
        write(provider, {
          models: existing?.models ?? null,
          warning: existing?.warning ?? null,
          loading: true
        })

        if (!window.vyotiq?.listModels) {
          write(provider, UNAVAILABLE)
          return UNAVAILABLE
        }

        const res = await window.vyotiq.listModels({
          provider,
          baseUrl:
            provider === 'ollama' && ollamaBaseUrl
              ? ollamaOpenAiBaseUrl(ollamaBaseUrl)
              : undefined,
          forceRefresh: opts?.forceRefresh
        })

        const entry: CacheEntry = res.ok
          ? { models: res.data.models, warning: res.data.warning ?? null, loading: false }
          : { models: null, warning: res.error, loading: false }
        write(provider, entry)
        return entry
      })()

      inflight.current.set(provider, run)
      try {
        return await run
      } finally {
        if (inflight.current.get(provider) === run) inflight.current.delete(provider)
      }
    },
    [ollamaBaseUrl, write]
  )

  const refreshKeyRef = useRef(modelsRefreshKey)
  useEffect(() => {
    if (refreshKeyRef.current === modelsRefreshKey) return
    refreshKeyRef.current = modelsRefreshKey
    inflight.current.clear()
    cacheRef.current = {}
    setCache(cacheRef.current)
  }, [modelsRefreshKey])

  const getEntry = useCallback(
    (provider: ProviderId): CacheEntry | undefined => cache[provider],
    [cache]
  )

  return { cache, loadProvider, getEntry, modelsRefreshKey }
}
