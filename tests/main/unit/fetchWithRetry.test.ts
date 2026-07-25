import { describe, expect, it } from 'vitest'
import {
  isRetriableNetworkError,
  isRetriableProviderMessage,
  RetriableStreamError
} from '@main/agent/providers/fetchWithRetry'

describe('isRetriableNetworkError', () => {
  it('detects ECONNRESET on cause chain', () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const err = new TypeError('terminated', { cause })
    expect(isRetriableNetworkError(err)).toBe(true)
  })

  it('detects other side closed message', () => {
    expect(isRetriableNetworkError(new Error('fetch failed: other side closed'))).toBe(true)
  })

  it('rejects abort errors', () => {
    expect(isRetriableNetworkError(new DOMException('Aborted', 'AbortError'))).toBe(false)
  })
})

describe('isRetriableProviderMessage', () => {
  it('matches transient provider disconnect phrases', () => {
    expect(isRetriableProviderMessage('fetch failed: other side closed')).toBe(true)
    expect(isRetriableProviderMessage('read ECONNRESET')).toBe(true)
    expect(isRetriableProviderMessage('HTTP 401: unauthorized')).toBe(false)
  })
})

describe('RetriableStreamError', () => {
  it('wraps stream read failures', () => {
    const inner = new Error('read ECONNRESET')
    const err = new RetriableStreamError('stream ended', inner)
    expect(err.name).toBe('RetriableStreamError')
    expect(err.cause).toBe(inner)
  })
})
