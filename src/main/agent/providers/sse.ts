/** Iterate SSE `data:` payloads from a fetch Response body. */
import { isAbortError } from '../../../shared/errors'
import { isRetriableNetworkError, RetriableStreamError } from './fetchWithRetry'
import { logProviderFailure } from './log'

export async function* iterateSseData(
  res: Response,
  signal: AbortSignal
): AsyncGenerator<string> {
  if (!res.body) {
    logProviderFailure('sse', 'stream', {})
    throw new Error('No response body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []

  const flush = (): string | null => {
    if (dataLines.length === 0) return null
    const data = dataLines.join('\n')
    dataLines = []
    return data
  }

  let finished = false
  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined)
        throw new DOMException('Aborted', 'AbortError')
      }
      let readResult: Awaited<ReturnType<typeof reader.read>>
      try {
        readResult = await reader.read()
      } catch (readErr) {
        if (isAbortError(readErr)) throw readErr
        if (isRetriableNetworkError(readErr)) {
          throw new RetriableStreamError(formatStreamReadError(readErr), readErr)
        }
        throw readErr
      }
      const { done, value } = readResult
      if (done) {
        finished = true
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''

      for (const raw of parts) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (line === '') {
          const data = flush()
          if (data === null) continue
          if (data === '[DONE]') return
          yield data
          continue
        }
        if (line.startsWith(':')) continue
        if (line.startsWith('data:')) {
          const v = line.slice(5)
          dataLines.push(v.startsWith(' ') ? v.slice(1) : v)
        }
      }
    }

    if (buffer.length) {
      const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
      if (line.startsWith('data:')) {
        const v = line.slice(5)
        dataLines.push(v.startsWith(' ') ? v.slice(1) : v)
      }
    }

    const data = flush()
    if (data !== null && data !== '[DONE]') yield data
  } finally {
    if (!finished) {
      await reader.cancel().catch(() => undefined)
    }
    try {
      reader.releaseLock()
    } catch {
      // already released
    }
  }
}

function formatStreamReadError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/**
 * Counts frames a stream had to discard. Silently swallowing them turns a
 * corrupted stream into a plausible-looking short answer, so callers surface
 * the count once the stream ends.
 */
export type SseDropCounter = { dropped: number }

export async function* iterateSseJson(
  res: Response,
  signal: AbortSignal,
  drops?: SseDropCounter
): AsyncGenerator<Record<string, unknown>> {
  for await (const data of iterateSseData(res, signal)) {
    if (!data.trim()) continue
    try {
      yield JSON.parse(data) as Record<string, unknown>
    } catch {
      if (drops) drops.dropped++
      logProviderFailure('sse', 'parse', { bytes: data.length })
    }
  }
}
