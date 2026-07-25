import { defaultSchema } from 'rehype-sanitize'

const allowedAttributes = {
  ...defaultSchema.attributes,
  span: [...(defaultSchema.attributes?.span ?? []), 'className', 'style'],
  code: [...(defaultSchema.attributes?.code ?? []), 'className', 'style'],
  pre: [...(defaultSchema.attributes?.pre ?? []), 'className', 'style']
}

export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: allowedAttributes
}

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
