import type { ProviderId } from '../../../shared/ipc'

type ProviderErrorJson = {
  error?: { message?: string; code?: unknown }
  message?: string
}

function parseProviderErrorMessage(body: string): string | undefined {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(trimmed) as ProviderErrorJson
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim()
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message.trim()
    }
  } catch {
    return undefined
  }
  return undefined
}

/** OpenRouter 402 bodies include "can only afford N" when max_tokens exceeds credit budget. */
export function parseOpenRouterAffordableOutputTokens(body: string): number | undefined {
  const match = /can only afford (\d+)/i.exec(body)
  if (!match) return undefined
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

export function formatProviderHttpError(
  status: number,
  body: string,
  providerId?: ProviderId
): string {
  const providerMessage = parseProviderErrorMessage(body)
  const affordable = providerId === 'openrouter' ? parseOpenRouterAffordableOutputTokens(body) : undefined

  if (status === 402) {
    if (providerId === 'openrouter') {
      if (affordable) {
        return `OpenRouter credits are insufficient for the requested output budget. Add credits at https://openrouter.ai/settings/credits or retry with a lower output limit (balance covers ~${affordable.toLocaleString()} output tokens).`
      }
      return (
        providerMessage ??
        'OpenRouter credits are insufficient for this request. Add credits at https://openrouter.ai/settings/credits.'
      )
    }
    return providerMessage ?? 'Insufficient provider credits for this request.'
  }

  if (status === 401 || status === 403) {
    return (
      providerMessage ??
      `Authentication failed (HTTP ${status}). Check your API key in Settings.`
    )
  }

  if (status === 429) {
    return providerMessage ?? 'Rate limited (HTTP 429). Wait a moment and try again.'
  }

  if (providerMessage) return providerMessage

  const snippet = body.trim().slice(0, 280)
  return snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`
}
