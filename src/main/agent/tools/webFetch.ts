import { lookup as dnsLookup } from 'dns/promises'
import { isIP } from 'net'

export const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024
export const WEB_FETCH_DEFAULT_TIMEOUT_MS = 20_000
export const WEB_FETCH_DEFAULT_MAX_CHARS = 40_000
export const WEB_FETCH_MAX_TIMEOUT_MS = 60_000
const MAX_BYTES = WEB_FETCH_MAX_BYTES
const DEFAULT_TIMEOUT_MS = WEB_FETCH_DEFAULT_TIMEOUT_MS
const MAX_TIMEOUT_MS = WEB_FETCH_MAX_TIMEOUT_MS
const DEFAULT_MAX_CHARS = WEB_FETCH_DEFAULT_MAX_CHARS
const MAX_REDIRECTS = 5

type LookupFn = typeof dnsLookup

let resolveHost: LookupFn = dnsLookup

/** Test helper — override DNS resolution for SSRF checks. */
export function setDnsLookupForTests(next: LookupFn): void {
  resolveHost = next
}

/** Test helper — restore default DNS resolution. */
export function resetDnsLookupForTests(): void {
  resolveHost = dnsLookup
}

/** Hosts that resolve inside the machine or the local network are never fetched. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported protocol ${url.protocol}; use http(s)`)
  }

  const host = stripIpv6Brackets(url.hostname).toLowerCase()
  if (isBlockedHostname(host)) {
    throw new Error(`Refusing to fetch a private or loopback address: ${url.hostname}`)
  }

  const literalVersion = isIP(host)
  if (literalVersion === 4) {
    if (isPrivateIpv4(host)) {
      throw new Error(`Refusing to fetch a private or loopback address: ${url.hostname}`)
    }
    return url
  }
  if (literalVersion === 6) {
    if (isPrivateIpv6(host)) {
      throw new Error(`Refusing to fetch a private or loopback address: ${url.hostname}`)
    }
    return url
  }

  const resolved = await resolveHost(host, { all: true, verbatim: true })
  if (resolved.length === 0) {
    throw new Error(`Could not resolve host: ${host}`)
  }
  for (const entry of resolved) {
    if (isPrivateResolvedAddress(entry.address)) {
      throw new Error(`Refusing to fetch a private or loopback address: ${host}`)
    }
  }

  return url
}

/**
 * Sync SSRF gate for Electron navigation events (no DNS).
 * Returns true when the URL must be refused immediately.
 * Hostnames that need DNS resolution return false — callers should
 * still `assertPublicUrl` after the load settles.
 */
export function isSyncBlockedUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return true
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return true

  const host = stripIpv6Brackets(url.hostname).toLowerCase()
  if (isBlockedHostname(host)) return true

  const literalVersion = isIP(host)
  if (literalVersion === 4) return isPrivateIpv4(host)
  if (literalVersion === 6) return isPrivateIpv6(host)
  return false
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

function isBlockedHostname(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  )
}

function parseIpv4Parts(host: string): [number, number, number, number] | null {
  if (/^\d+$/.test(host)) {
    const value = Number(host)
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null
    return [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff
    ]
  }

  const parts = host.split('.')
  if (parts.length < 1 || parts.length > 4) return null

  const nums: number[] = []
  for (const part of parts) {
    if (!/^(0x[0-9a-f]+|\d+)$/i.test(part)) return null
    const value = Number.parseInt(part, part.startsWith('0x') ? 16 : 10)
    if (!Number.isFinite(value) || value < 0) return null
    nums.push(value)
  }

  if (nums.length === 4) {
    if (nums.some((n) => n > 255)) return null
    return nums as [number, number, number, number]
  }

  if (nums.length === 3) {
    if (nums[0] > 255 || nums[1] > 255) return null
    return [nums[0], nums[1], nums[2], 0]
  }
  if (nums.length === 2) {
    if (nums[0] > 255) return null
    return [nums[0], nums[1], 0, 0]
  }
  if (nums.length === 1) {
    const value = nums[0]
    if (value > 0xffffffff) return null
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
  }

  return null
}

function isPrivateIpv4Bytes(a: number, b: number, c: number, d: number): boolean {
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a >= 224) return true
  return a === 0 && b === 0 && c === 0 && d === 0
}

function isPrivateIpv4(host: string): boolean {
  const parts = parseIpv4Parts(host)
  if (!parts) return false
  return isPrivateIpv4Bytes(...parts)
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('fe80:')) return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])

  return false
}

function isPrivateResolvedAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isPrivateIpv4(address)
  if (version === 6) return isPrivateIpv6(address)
  return true
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

/**
 * Convert HTML to a rough markdown skeleton.
 *
 * The point is to keep the structure a reader relies on — headings, links, list
 * items, code — while dropping the markup that would otherwise burn context.
 */
export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, '')

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<h[456][^>]*>/gi, '\n#### ')
    .replace(/<code[^>]*>/gi, '`')
    .replace(/<\/code>/gi, '`')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const clean = label.replace(/<[^>]+>/g, '').trim()
      return clean ? `[${clean}](${href})` : href
    })
    .replace(/<[^>]+>/g, '')

  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export type WebFetchOptions = {
  timeoutMs?: number
  maxChars?: number
}

/** Fetch a public URL and return readable text, size- and time-capped. */
export async function toolWebFetch(
  rawUrl: string,
  options: WebFetchOptions = {},
  signal?: AbortSignal
): Promise<string> {
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  const maxChars = Math.max(1000, options.maxChars ?? DEFAULT_MAX_CHARS)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onParentAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })

  let currentUrl: URL | undefined
  try {
    currentUrl = await assertPublicUrl(String(rawUrl ?? '').trim())
    const { response: res, finalUrl } = await fetchWithValidatedRedirects(currentUrl, controller.signal)
    currentUrl = finalUrl
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${currentUrl.href}`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (/^(image|audio|video|application\/(octet-stream|pdf|zip))/i.test(contentType)) {
      throw new Error(`Unsupported content type ${contentType || 'unknown'} for ${currentUrl.href}`)
    }

    const buffer = await readCapped(res, MAX_BYTES)
    const body = buffer.toString('utf8')
    const text = /html/i.test(contentType) ? htmlToMarkdown(body) : body.trim()
    const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n… (truncated)` : text

    return [`# ${currentUrl.href}`, '', clipped].join('\n')
  } catch (err) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`Timed out after ${timeoutMs}ms fetching ${currentUrl?.href ?? rawUrl}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onParentAbort)
  }
}

async function fetchWithValidatedRedirects(
  startUrl: URL,
  signal: AbortSignal,
  headers?: HeadersInit
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = startUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validated = await assertPublicUrl(currentUrl.href)
    const res = await fetch(validated, {
      signal,
      redirect: 'manual',
      headers: headers ?? { accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' }
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) {
        throw new Error(`Redirect response missing Location header for ${validated.href}`)
      }
      if (hop === MAX_REDIRECTS) {
        throw new Error(`Too many redirects while fetching ${startUrl.href}`)
      }
      currentUrl = new URL(location, validated)
      continue
    }

    return { response: res, finalUrl: validated }
  }

  throw new Error(`Too many redirects while fetching ${startUrl.href}`)
}

/** Stop reading once the cap is hit rather than buffering an unbounded body. */
async function readCapped(res: Response, cap: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0

  try {
    while (total < cap) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      chunks.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  return Buffer.concat(chunks).subarray(0, cap)
}

/** Shared by web_search — public SSRF-safe fetch with redirect validation. */
export async function fetchPublicResponse(
  startUrl: URL,
  signal: AbortSignal,
  headers?: HeadersInit
): Promise<{ response: Response; finalUrl: URL; body: Buffer }> {
  const { response, finalUrl } = await fetchWithValidatedRedirects(startUrl, signal, headers)
  const body = await readCapped(response, MAX_BYTES)
  return { response, finalUrl, body }
}
