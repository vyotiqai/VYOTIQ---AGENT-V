import { defaultSchema } from 'rehype-sanitize'

/** Markdown body sanitization — highlighted code uses `sanitizeHighlightedHtml` instead. */
export const markdownSanitizeSchema = defaultSchema

const ALLOWED_TAGS = new Set([
  'span',
  'code',
  'pre',
  'div',
  'p',
  'br',
  'strong',
  'em',
  'a',
  'ul',
  'ol',
  'li'
])

/** Attributes Shiki / highlight markup may keep on allowed tags. */
const ALLOWED_ATTRS = new Set([
  'class',
  'style',
  'href',
  'title',
  'aria-hidden',
  'tabindex',
  'data-line',
  'data-language'
])

const SAFE_HREF = /^(https?:|mailto:|#|\/)/i

function sanitizeAttrValue(name: string, value: string): string | null {
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) return null
  if (!ALLOWED_ATTRS.has(lower)) return null

  if (lower === 'href') {
    const trimmed = value.trim()
    if (!SAFE_HREF.test(trimmed)) return null
    return trimmed
  }

  if (lower === 'style') {
    // Drop CSS that can execute or navigate (expression / url(javascript:) / -moz-binding).
    if (/expression\s*\(|url\s*\(\s*['"]?\s*javascript:|-moz-binding/i.test(value)) {
      return null
    }
    return value
  }

  return value
}

function sanitizeOpenTag(tag: string, attrs: string): string {
  const name = tag.toLowerCase()
  if (!ALLOWED_TAGS.has(name)) return ''

  const cleaned: string[] = []
  const attrRe =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi
  let match: RegExpExecArray | null
  while ((match = attrRe.exec(attrs)) !== null) {
    const attrName = match[1]!
    if (attrName === '/' || attrName === '') continue
    const raw = match[2] ?? match[3] ?? match[4] ?? ''
    const safe = sanitizeAttrValue(attrName, raw)
    if (safe === null) continue
    const escaped = safe.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    cleaned.push(`${attrName.toLowerCase()}="${escaped}"`)
  }

  return cleaned.length > 0 ? `<${name} ${cleaned.join(' ')}>` : `<${name}>`
}

/**
 * Strip disallowed tags and dangerous attributes from Shiki-highlighted HTML
 * before `dangerouslySetInnerHTML`.
 */
export function sanitizeHighlightedHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/([a-z0-9-]+)\s*>/gi, (full, tag: string) =>
      ALLOWED_TAGS.has(tag.toLowerCase()) ? full : ''
    )
    .replace(/<([a-z0-9-]+)([^>]*)>/gi, (_full, tag: string, attrs: string) =>
      sanitizeOpenTag(tag, attrs ?? '')
    )
}
