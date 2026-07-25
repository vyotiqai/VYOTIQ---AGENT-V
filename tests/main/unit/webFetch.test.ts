import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertPublicUrl,
  resetDnsLookupForTests,
  setDnsLookupForTests,
  toolWebFetch
} from '@main/agent/tools/webFetch'

const PUBLIC_IP = '93.184.216.34'

afterEach(() => {
  resetDnsLookupForTests()
  vi.restoreAllMocks()
})

describe('assertPublicUrl', () => {
  it('rejects loopback hostnames and private IPv4 literals', async () => {
    await expect(assertPublicUrl('http://localhost/')).rejects.toThrow(/private or loopback/)
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toThrow(/private or loopback/)
    await expect(assertPublicUrl('http://127.1/')).rejects.toThrow(/private or loopback/)
    await expect(assertPublicUrl('http://2130706433/')).rejects.toThrow(/private or loopback/)
    await expect(assertPublicUrl('http://192.168.1.1/')).rejects.toThrow(/private or loopback/)
    await expect(assertPublicUrl('http://169.254.169.254/')).rejects.toThrow(/private or loopback/)
  })

  it('rejects private IPv6 literals', async () => {
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow(/private or loopback/)
    await expect(assertPublicUrl('http://[fe80::1]/')).rejects.toThrow(/private or loopback/)
  })

  it('rejects hostnames that resolve to private addresses', async () => {
    setDnsLookupForTests(async () => [{ address: '127.0.0.1', family: 4 }])

    await expect(assertPublicUrl('http://example.test/')).rejects.toThrow(/private or loopback/)
  })

  it('allows public hostnames that resolve to public addresses', async () => {
    setDnsLookupForTests(async () => [{ address: PUBLIC_IP, family: 4 }])

    const url = await assertPublicUrl('http://example.test/')
    expect(url.hostname).toBe('example.test')
  })
})

describe('toolWebFetch redirects', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch
  })

  it('rejects redirects to private hosts', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:11434/' }
      })
    }) as typeof fetch

    await expect(toolWebFetch(`https://${PUBLIC_IP}/`)).rejects.toThrow(/private or loopback/)
  })

  it('follows safe redirects and validates each hop', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://${PUBLIC_IP}/final` }
        })
      )
      .mockResolvedValueOnce(
        new Response('<html><body><p>hello</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
      ) as typeof fetch

    const out = await toolWebFetch(`https://${PUBLIC_IP}/start`)
    expect(out).toContain(`# https://${PUBLIC_IP}/final`)
    expect(out).toContain('hello')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })
})
