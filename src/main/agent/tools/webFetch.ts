const MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 60_000
const DEFAULT_MAX_CHARS = 40_000

/** Hosts that resolve inside the machine or the local network are never fetched. */
function assertPublicUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Not a valid URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported protocol ${url.protocol}; use http(s)`)
  }

  const host = url.hostname.toLowerCase()
  const isLoopback =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    /^0\./.test(host)
  const isPrivate =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.internal') ||
    host.endsWith('.local')

  if (isLoopback || isPrivate) {
    throw new Error(`Refusing to fetch a private or loopback address: ${url.hostname}`)
  }
  return url
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
  const url = assertPublicUrl(String(rawUrl ?? '').trim())
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  const maxChars = Math.max(1000, options.maxChars ?? DEFAULT_MAX_CHARS)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onParentAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' }
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url.href}`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (/^(image|audio|video|application\/(octet-stream|pdf|zip))/i.test(contentType)) {
      throw new Error(`Unsupported content type ${contentType || 'unknown'} for ${url.href}`)
    }

    const buffer = await readCapped(res, MAX_BYTES)
    const body = buffer.toString('utf8')
    const text = /html/i.test(contentType) ? htmlToMarkdown(body) : body.trim()
    const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n… (truncated)` : text

    return [`# ${url.href}`, '', clipped].join('\n')
  } catch (err) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`Timed out after ${timeoutMs}ms fetching ${url.href}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onParentAbort)
  }
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
