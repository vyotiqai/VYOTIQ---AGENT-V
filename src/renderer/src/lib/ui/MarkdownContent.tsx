import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { CodeBlockCopyButton } from './CodeBlockCopyButton'
import { highlightCode } from '@renderer/lib/markdown/markdownHighlight'
import {
  balanceOutsideFences,
  closeOpenFence,
  isFenceCloser,
  parseFenceLine,
  trailingOpenFenceBody
} from '@renderer/lib/markdown/fenceUtils'
import { markdownSanitizeSchema, sanitizeHighlightedHtml } from '@renderer/lib/markdown/markdownSanitize'
import { cn } from './cn'
import { useDocumentTheme } from './useDocumentTheme'

export { trailingOpenFenceBody } from '@renderer/lib/markdown/fenceUtils'

/** Close an unclosed fence so streaming partials still parse as code. */
export function prepareStreamingMarkdown(content: string): string {
  return closeOpenFence(content)
}

/** Balance unclosed inline markdown when a stream completes. */
export function balanceIncompleteMarkdown(content: string): string {
  return balanceOutsideFences(content)
}

/**
 * Split markdown into stable block units (paragraphs / fences / headings).
 * Finished blocks keep stable identity so React.memo can skip them while the
 * last block streams. Fence boundaries use the same CommonMark rules as
 * {@link closeOpenFence} (variable length, indented openers).
 */
export function splitMarkdownBlocks(source: string): string[] {
  if (!source) return []
  const lines = source.split('\n')
  const blocks: string[] = []
  let i = 0
  while (i < lines.length) {
    const parsed = parseFenceLine(lines[i]!)
    if (parsed) {
      const open = parsed.open
      let j = i + 1
      while (j < lines.length && !isFenceCloser(lines[j]!, open)) j++
      if (j >= lines.length) {
        blocks.push(lines.slice(i).join('\n'))
        break
      }
      // Include closer; keep a trailing newline when more content follows so the
      // next block's start index stays stable across streaming ticks.
      const end = j + 1
      const chunk = lines.slice(i, end).join('\n')
      blocks.push(end < lines.length ? `${chunk}\n` : chunk)
      i = end
      continue
    }

    // Paragraph / prose: consume through the next blank line (inclusive) or up
    // to the next fence opener.
    let j = i + 1
    while (j < lines.length) {
      if (lines[j] === '') {
        j++
        break
      }
      if (parseFenceLine(lines[j]!)) break
      j++
    }
    blocks.push(lines.slice(i, j).join('\n'))
    i = j
  }
  return blocks.filter((b) => b.length > 0)
}

/** Max highlighted fence entries retained across the renderer session. */
export const HIGHLIGHT_CACHE_MAX_ENTRIES = 200

const highlightCache = new Map<string, string>()

const remarkPlugins = [remarkGfm]
const rehypePlugins: import('react-markdown').Options['rehypePlugins'] = [
  [rehypeSanitize, markdownSanitizeSchema]
]

function highlightCacheKey(text: string, lang: string, theme: string): string {
  return `${theme}\0${lang}\0${text}`
}

/** FIFO-bounded set; exported helpers used by FencedCodeBlock and tests. */
export function setHighlightCacheEntry(key: string, html: string): void {
  if (highlightCache.has(key)) {
    highlightCache.delete(key)
  }
  highlightCache.set(key, html)
  while (highlightCache.size > HIGHLIGHT_CACHE_MAX_ENTRIES) {
    const oldest = highlightCache.keys().next().value
    if (oldest === undefined) break
    highlightCache.delete(oldest)
  }
}

export function getHighlightCacheEntry(key: string): string | undefined {
  return highlightCache.get(key)
}

/** @internal Reset cache between tests. */
export function clearHighlightCacheForTests(): void {
  highlightCache.clear()
}

/** @internal */
export function highlightCacheSizeForTests(): number {
  return highlightCache.size
}

function scheduleIdle(cb: () => void, timeoutMs: number): () => void {
  const w = typeof window !== 'undefined' ? window : null
  if (w && typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(() => cb(), { timeout: timeoutMs })
    return () => w.cancelIdleCallback(id)
  }
  const id = globalThis.setTimeout(cb, Math.min(timeoutMs, 80))
  return () => globalThis.clearTimeout(id)
}

const CODE_SHELL =
  'overflow-x-auto rounded-md border border-border bg-surface font-mono text-[0.85em]'

function FencedCodeBlock({
  text,
  className,
  unstable = false
}: {
  text: string
  className?: string
  /** Still being streamed, so highlighting it would be re-thrown away next delta. */
  unstable?: boolean
}) {
  const lang = className?.replace(/^language-/, '') ?? ''
  const theme = useDocumentTheme()
  const cacheKey = highlightCacheKey(text, lang, theme)
  const [html, setHtml] = useState<string | null>(() =>
    unstable ? null : (getHighlightCacheEntry(cacheKey) ?? null)
  )

  useEffect(() => {
    if (unstable) {
      // Drop stale highlight while the fence is still growing; plain shell stays.
      setHtml(null)
      return
    }
    const cached = getHighlightCacheEntry(cacheKey)
    if (cached) {
      setHtml(cached)
      return
    }
    // Invalidate any prior highlight so plain text matches `text` until ready.
    // Unified shell keeps the bordered container — this is not an empty flash.
    setHtml(null)
    let cancelled = false
    const cancelIdle = scheduleIdle(() => {
      void highlightCode(text, lang).then((result) => {
        if (cancelled) return
        const next = result ? sanitizeHighlightedHtml(result) : null
        if (next) setHighlightCacheEntry(cacheKey, next)
        setHtml(next)
      })
    }, 80)
    return () => {
      cancelled = true
      cancelIdle()
    }
  }, [text, lang, unstable, theme, cacheKey])

  return (
    <div className="group/code relative my-2">
      <CodeBlockCopyButton text={text} />
      <div className={CODE_SHELL}>
        {html ? (
          <div
            className="vy-transition [&>pre]:m-0 [&>pre]:overflow-x-auto [&>pre]:bg-transparent [&>pre]:p-3"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="m-0 overflow-x-auto bg-transparent p-3">
            <code className={cn('block', className)}>{text}</code>
          </pre>
        )}
      </div>
    </div>
  )
}

function FencedCodePre({
  children,
  openFenceBody
}: {
  children?: ReactNode
  openFenceBody: string | null
}) {
  const child = Children.toArray(children).find(isValidElement) as
    | ReactElement<{ className?: string; children?: ReactNode }>
    | undefined
  if (!child) {
    return (
      <pre className="my-2 overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-[0.85em]">
        {children}
      </pre>
    )
  }

  const className = child.props.className ?? ''
  const text = String(child.props.children ?? '').replace(/\n$/, '')
  const unstable = openFenceBody !== null && text.replace(/\n+$/, '') === openFenceBody.replace(/\n+$/, '')
  return <FencedCodeBlock text={text} className={className} unstable={unstable} />
}

function buildMarkdownComponents(openFenceBody: string | null) {
  return {
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} target="_blank" rel="noreferrer noopener" className="text-fg-strong underline">
        {children}
      </a>
    ),
    code: ({
      className: codeClass,
      children
    }: {
      className?: string
      children?: React.ReactNode
    }) => {
      if (codeClass?.includes('language-')) {
        return <code className={cn('block font-mono text-[0.85em]', codeClass)}>{children}</code>
      }
      return (
        <code className="rounded-sm bg-surface px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
      )
    },
    pre: ({ children }: { children?: React.ReactNode }) => (
      <FencedCodePre openFenceBody={openFenceBody}>{children}</FencedCodePre>
    )
  }
}

const MemoMarkdownBlock = memo(function MemoMarkdownBlock({
  source,
  openFenceBody
}: {
  source: string
  openFenceBody: string | null
}) {
  const components = useMemo(() => buildMarkdownComponents(openFenceBody), [openFenceBody])
  return (
    <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {source}
    </Markdown>
  )
})

export function MarkdownContent({
  content,
  streaming = false,
  className
}: {
  content: string
  streaming?: boolean
  className?: string
}) {
  const markdown = useMemo(
    () => (streaming ? prepareStreamingMarkdown(content) : balanceIncompleteMarkdown(content)),
    [streaming, content]
  )
  const openFenceBody = useMemo(
    () => (streaming ? trailingOpenFenceBody(content) : null),
    [streaming, content]
  )
  const blocks = useMemo(() => splitMarkdownBlocks(markdown), [markdown])
  const hasVisibleContent = content.trim().length > 0

  if (!hasVisibleContent) return null

  return (
    <div
      className={cn(
        'markdown-body text-sm leading-relaxed text-fg [overflow-wrap:anywhere]',
        className
      )}
    >
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1
        const blockOpenFence = streaming && isLast ? openFenceBody : null
        // Stable keys so streaming deltas update `source` instead of remounting.
        const key =
          streaming && isLast ? `md-block-${index}-tail` : `md-block-${index}`
        return (
          <MemoMarkdownBlock key={key} source={block} openFenceBody={blockOpenFence} />
        )
      })}
    </div>
  )
}
