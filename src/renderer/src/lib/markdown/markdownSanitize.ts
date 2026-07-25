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

export function sanitizeHighlightedHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<([a-z0-9-]+)([^>]*)>/gi, (match, tag: string) => {
      if (!ALLOWED_TAGS.has(tag.toLowerCase())) return ''
      return match
    })
}
