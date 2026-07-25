export class RetriableStreamError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'RetriableStreamError'
    if (cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = cause
    }
  }
}

export function isRetriableProviderMessage(message: string): boolean {
  return /other side closed|ECONNRESET|terminated|socket hang up|fetch failed/i.test(message)
}

export function isRetriableNetworkError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false
  if (err instanceof Error && err.name === 'AbortError') return false

  const codes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'])
  let current: unknown = err
  while (current) {
    if (typeof current === 'object' && current !== null) {
      const code = (current as { code?: string }).code
      if (typeof code === 'string' && codes.has(code)) return true
      const message = (current as { message?: string }).message
      if (typeof message === 'string' && isRetriableProviderMessage(message)) return true
    }
    current =
      current instanceof Error
        ? (current as Error & { cause?: unknown }).cause
        : undefined
  }

  if (err instanceof Error && isRetriableProviderMessage(err.message)) return true
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  opts?: { maxAttempts?: number }
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 3
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init)
      if ((response.status >= 500 || response.status === 429) && attempt < maxAttempts) {
        await delay(attempt * 250)
        continue
      }
      return response
    } catch (err) {
      lastError = err
      if (init.signal?.aborted) throw err
      if (!isRetriableNetworkError(err) || attempt >= maxAttempts) throw err
      await delay(attempt * 250)
    }
  }

  throw lastError ?? new Error('fetch failed')
}
