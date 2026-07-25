import { createHash } from 'crypto'
import type { ModelInfo, ProviderId } from '../../../shared/ipc'

type CacheEntry = {
  models: ModelInfo[]
  expiresAt: number
}

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, CacheEntry>()

export function modelCacheKey(
  provider: ProviderId,
  baseUrl: string | undefined,
  apiKey: string | null | undefined
): string {
  const fingerprint = apiKey
    ? createHash('sha256').update(apiKey).digest('hex').slice(0, 12)
    : 'nokey'
  return `${provider}|${baseUrl ?? ''}|${fingerprint}`
}

export function getCachedModels(key: string): ModelInfo[] | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.models
}

export function setCachedModels(key: string, models: ModelInfo[]): void {
  cache.set(key, { models, expiresAt: Date.now() + TTL_MS })
}

export function clearModelCache(): void {
  cache.clear()
}

export function clearModelCacheKey(key: string): void {
  cache.delete(key)
}
