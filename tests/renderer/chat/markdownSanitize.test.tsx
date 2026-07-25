/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { MarkdownContent } from '@renderer/lib/ui/MarkdownContent'
import { markdownSanitizeSchema } from '@renderer/lib/markdown/markdownSanitize'

afterEach(() => {
  cleanup()
})

function renderMarkdown(content: string): HTMLElement {
  return render(<MarkdownContent content={content} />).container
}

describe('markdown sanitization — url protocols', () => {
  it('drops javascript: link hrefs', () => {
    const container = renderMarkdown('[click me](javascript:alert(1))')

    const anchor = container.querySelector('a')
    expect(anchor?.textContent).toBe('click me')
    expect(anchor?.getAttribute('href')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('drops javascript: image sources', () => {
    const container = renderMarkdown('![boom](javascript:alert(1))')

    expect(container.querySelector('img')?.getAttribute('src')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('drops data:text/html link hrefs', () => {
    const container = renderMarkdown(
      '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'
    )

    expect(container.querySelector('a')?.getAttribute('href')).toBeNull()
    expect(container.innerHTML).not.toContain('data:text/html')
  })

  it('drops vbscript: link hrefs', () => {
    const container = renderMarkdown('[click](vbscript:msgbox("x"))')

    expect(container.querySelector('a')?.getAttribute('href')).toBeNull()
    expect(container.innerHTML).not.toContain('vbscript:')
  })

  it('drops entity-obfuscated javascript: hrefs', () => {
    const container = renderMarkdown('[click](&#106;avascript:alert(1))')

    expect(container.querySelector('a')?.getAttribute('href')).toBeNull()
    expect(container.innerHTML.toLowerCase()).not.toContain('javascript:')
  })

  it('keeps http and https link hrefs', () => {
    const container = renderMarkdown('[docs](https://example.com/a)')

    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a')
  })
})

describe('markdown sanitization — raw html', () => {
  const vectors: Array<[string, string]> = [
    ['script', '<script>window.__pwned = true</script>'],
    ['iframe', '<iframe src="https://evil.test"></iframe>'],
    ['object', '<object data="https://evil.test"></object>'],
    ['embed', '<embed src="https://evil.test">'],
    ['form + formaction', '<form action="https://evil.test"><button formaction="javascript:alert(1)">go</button></form>'],
    ['event handler', '<img src="x" onerror="window.__pwned = true">'],
    ['inline style url()', '<div style="background-image:url(javascript:alert(1))">styled</div>'],
    ['inline style expression()', '<span style="width:expression(alert(1))">styled</span>'],
    ['srcset', '<img srcset="x 1x" src="x">'],
    ['picture source srcset', '<picture><source srcset="x"><img src="x"></picture>'],
    ['svg script', '<svg><script>window.__pwned = true</script></svg>'],
    ['svg animate onbegin', '<svg><animate onbegin="window.__pwned = true" attributeName="x"></animate></svg>'],
    ['svg xlink:href', '<svg><a xlink:href="javascript:alert(1)"><text>go</text></a></svg>'],
    ['base href', '<base href="https://evil.test/">'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.test">']
  ]

  for (const [name, markup] of vectors) {
    it(`neutralizes ${name}`, () => {
      const container = renderMarkdown(markup)
      const html = container.innerHTML.toLowerCase()

      expect(container.querySelector('script,iframe,object,embed,form,base,meta,svg,animate')).toBeNull()
      expect(html).not.toContain('onerror')
      expect(html).not.toContain('onbegin')
      expect(html).not.toContain('formaction')
      expect(html).not.toContain('srcset')
      expect(html).not.toContain('javascript:')
      expect(html).not.toContain('expression(')
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
    })
  }

  it('renders raw html as inert text rather than markup', () => {
    const container = renderMarkdown('before <b>bold</b> after')

    expect(container.querySelector('b')).toBeNull()
  })
})

describe('markdown sanitization — schema', () => {
  it('does not allow style attributes through the schema', () => {
    const attributes = markdownSanitizeSchema.attributes as Record<string, unknown[]>
    for (const [tag, list] of Object.entries(attributes)) {
      expect(list.includes('style'), `${tag} allows style`).toBe(false)
    }
  })

  it('only allows language-* class names on code', () => {
    const codeAttributes = (markdownSanitizeSchema.attributes as Record<string, unknown[]>).code
    expect(codeAttributes.includes('className')).toBe(false)
  })
})

describe('highlighted code output', () => {
  it('escapes html inside a highlighted fence', async () => {
    const { container } = render(
      <MarkdownContent content={'```js\nconst a = "<img src=x onerror=alert(1)>"\n```'} />
    )

    await waitFor(() => {
      expect(container.querySelector('pre.shiki')).toBeTruthy()
    })
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(container.textContent).toContain('const a = "<img src=x onerror=alert(1)>"')
  })
})

describe('link handling', () => {
  it('opens external links in a new context with noopener', () => {
    const container = renderMarkdown('[docs](https://example.com)')

    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('target')).toBe('_blank')
    expect(anchor?.getAttribute('rel')).toContain('noopener')
    expect(anchor?.getAttribute('rel')).toContain('noreferrer')
  })
})
