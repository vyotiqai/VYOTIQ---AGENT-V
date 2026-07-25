import {
  Children,
  isValidElement,
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
import { markdownSanitizeSchema, sanitizeHighlightedHtml } from '@renderer/lib/markdown/markdownSanitize'
import { cn } from './cn'

function closeFenceMarker(content: string, marker: string): string {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fences = content.match(new RegExp(`^${escaped}`, 'gm'))
  if (fences && fences.length % 2 === 1) {
    return `${content}\n${marker}`
  }
  return content
}

/** Close an unclosed ``` or ~~~ fence so streaming partials still parse as code. */
export function closeOpenFence(content: string): string {
  let result = closeFenceMarker(content, '```')
  result = closeFenceMarker(result, '~~~')
  return result
}

export function prepareStreamingMarkdown(content: string): string {
  return closeOpenFence(content)
}

/** Balance unclosed inline markdown when a stream completes. */
export function balanceIncompleteMarkdown(content: string): string {
  const openBacktick = ((content.match(/^```/gm) ?? []).length % 2) === 1
  const openTilde = ((content.match(/^~~~/gm) ?? []).length % 2) === 1
  if (openBacktick || openTilde) {
    return closeOpenFence(content)
  }

  let result = content
  const doubleStars = (result.match(/(?<!\\)\*\*/g) ?? []).length
  if (doubleStars % 2 === 1) {
    result += '**'
  }

  const backticks = (result.match(/(?<!\\)`/g) ?? []).length
  if (backticks % 2 === 1) {
    result += '`'
  }

  return result
}

function useDocumentTheme(): string {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' ? (document.documentElement.dataset.theme ?? 'light') : 'light'
  )

  useEffect(() => {
    const root = document.documentElement
    const sync = (): void => {
      setTheme(root.dataset.theme ?? 'light')
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])

  return theme
}

function FencedCodeBlock({
  text,
  className,
  streaming = false
}: {
  text: string
  className?: string
  streaming?: boolean
}) {
  const [html, setHtml] = useState<string | null>(null)
  const lang = className?.replace(/^language-/, '') ?? ''
  const theme = useDocumentTheme()

  useEffect(() => {
    if (streaming) {
      setHtml(null)
      return
    }
    let cancelled = false
    void highlightCode(text, lang).then((result) => {
      if (!cancelled) setHtml(result ? sanitizeHighlightedHtml(result) : null)
    })
    return () => {
      cancelled = true
    }
  }, [text, lang, streaming, theme])

  if (html) {
    return (
      <div className="group/code relative my-2">
        <CodeBlockCopyButton text={text} />
        <div
          className="overflow-x-auto rounded-md border border-border bg-surface font-mono text-[0.85em] [&>pre]:m-0 [&>pre]:overflow-x-auto [&>pre]:bg-transparent [&>pre]:p-3"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    )
  }

  return (
    <div className="group/code relative my-2">
      <CodeBlockCopyButton text={text} />
      <pre className="overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-[0.85em]">
        <code className={cn('block', className)}>{text}</code>
      </pre>
    </div>
  )
}

function FencedCodePre({
  children,
  streaming = false
}: {
  children?: ReactNode
  streaming?: boolean
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
  return <FencedCodeBlock text={text} className={className} streaming={streaming} />
}

function buildMarkdownComponents(streaming: boolean) {
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
      // Block fences are handled by `pre` → FencedCodeBlock; this path is inline only.
      // Still render language-* as plain block text when nested under pre extraction.
      if (codeClass?.includes('language-')) {
        return <code className={cn('block font-mono text-[0.85em]', codeClass)}>{children}</code>
      }
      return (
        <code className="rounded-sm bg-surface px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
      )
    },
    pre: ({ children }: { children?: React.ReactNode }) => (
      <FencedCodePre streaming={streaming}>{children}</FencedCodePre>
    )
  }
}

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
  const components = useMemo(() => buildMarkdownComponents(streaming), [streaming])

  if (!content && !streaming) return null

  return (
    <div
      className={cn(
        'markdown-body text-sm leading-relaxed text-fg [overflow-wrap:anywhere]',
        className
      )}
    >
      {markdown ? (
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
          components={components}
        >
          {markdown}
        </Markdown>
      ) : null}
      {streaming ? <span className="streaming-caret-inline" aria-hidden /> : null}
    </div>
  )
}
