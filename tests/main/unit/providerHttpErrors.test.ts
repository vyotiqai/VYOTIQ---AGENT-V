import { describe, expect, it } from 'vitest'
import {
  formatProviderHttpError,
  parseOpenRouterAffordableOutputTokens
} from '@main/agent/providers/httpErrors'

const OPENROUTER_402 = JSON.stringify({
  error: {
    message:
      'This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 54013. To increase, visit https://openrouter.ai/settings/credits and add more credits',
    code: 402
  }
})

describe('formatProviderHttpError', () => {
  it('formats OpenRouter 402 with affordable token hint', () => {
    const msg = formatProviderHttpError(402, OPENROUTER_402, 'openrouter')
    expect(msg).toMatch(/OpenRouter credits are insufficient/i)
    expect(msg).toMatch(/54,013/)
    expect(msg).toMatch(/openrouter\.ai\/settings\/credits/)
    expect(msg).not.toMatch(/HTTP 402/)
  })

  it('extracts provider JSON message for generic errors', () => {
    const body = JSON.stringify({ error: { message: 'Invalid model id' } })
    expect(formatProviderHttpError(400, body, 'openrouter')).toBe('Invalid model id')
  })

  it('unwraps OpenRouter nested metadata.raw under Provider returned error', () => {
    const body = JSON.stringify({
      error: {
        message: 'Provider returned error',
        code: 400,
        metadata: {
          raw: JSON.stringify({
            error: {
              message: 'The encrypted content for item rs_abc could not be verified.',
              type: 'invalid_request_error'
            }
          })
        }
      }
    })
    expect(formatProviderHttpError(400, body, 'openrouter')).toMatch(/encrypted content/i)
  })

  it('scrubs API key-shaped secrets from provider messages', () => {
    const body = JSON.stringify({
      error: { message: 'Invalid key sk-abcdefghijklmnopqrstuvwxyz012345' }
    })
    const msg = formatProviderHttpError(400, body, 'openai')
    expect(msg).toContain('[redacted]')
    expect(msg).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz/)
  })

  it('maps auth failures to a settings hint', () => {
    expect(formatProviderHttpError(401, '', 'openai')).toMatch(/API key/i)
  })
})

describe('parseOpenRouterAffordableOutputTokens', () => {
  it('parses affordable output tokens from 402 body', () => {
    expect(parseOpenRouterAffordableOutputTokens(OPENROUTER_402)).toBe(54013)
  })
})
