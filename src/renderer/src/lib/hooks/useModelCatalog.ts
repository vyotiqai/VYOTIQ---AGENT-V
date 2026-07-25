import { useCallback } from 'react'
import type { ProviderId } from '@shared/ipc'
import type { ListModelsResult } from '@shared/ipc/schemas/providers'

type RefreshOptions = {
  forceRefresh?: boolean
  provider?: ProviderId
  ollamaBaseUrl?: string
}

export function useModelCatalog(
  provider: ProviderId,
  ollamaBaseUrl?: string,
  _apiKey?: string | null,
  _enabled = true
): {
  refresh: (opts?: RefreshOptions) => Promise<
    { ok: true; data: ListModelsResult; warning?: string; models: ListModelsResult['models'] } | { ok: false; error: string }
  >
} {
  const refresh = useCallback(
    async (opts?: RefreshOptions) => {
      if (!window.vyotiq?.listModels) {
        return { ok: false as const, error: 'Unavailable' }
      }
      const targetProvider = opts?.provider ?? provider
      const res = await window.vyotiq.listModels({
        provider: targetProvider,
        baseUrl:
          targetProvider === 'ollama' ? opts?.ollamaBaseUrl ?? ollamaBaseUrl : undefined,
        forceRefresh: opts?.forceRefresh ?? true
      })
      if (!res.ok) return res
      return {
        ok: true as const,
        data: res.data,
        models: res.data.models,
        warning: res.data.warning
      }
    },
    [provider, ollamaBaseUrl]
  )

  return { refresh }
}
