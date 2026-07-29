import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ActiveMentionToken = {
  start: number
  end: number
  query: string
}

/** Active `@path` token at caret (line start or after whitespace). */
export function findActiveMentionToken(
  text: string,
  cursor: number
): ActiveMentionToken | null {
  const pos = Math.max(0, Math.min(cursor, text.length))
  let start = pos
  while (start > 0) {
    const ch = text[start - 1]
    if (ch === '\n' || ch === ' ' || ch === '\t') break
    start -= 1
  }
  if (text[start] !== '@') return null
  if (start > 0) {
    const before = text[start - 1]
    if (before !== '\n' && before !== ' ' && before !== '\t') return null
  }
  let end = start + 1
  while (end < text.length) {
    const ch = text[end]
    if (ch === ' ' || ch === '\t' || ch === '\n') break
    end += 1
  }
  if (pos > end) return null
  return {
    start,
    end,
    query: text.slice(start + 1, end)
  }
}

export function useComposerMentions({
  workspacePath,
  text,
  cursor,
  enabled
}: {
  workspacePath?: string | null
  text: string
  cursor: number
  enabled: boolean
}) {
  const [paths, setPaths] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const reqIdRef = useRef(0)

  const token = useMemo(() => {
    if (!enabled) return null
    return findActiveMentionToken(text, cursor)
  }, [enabled, text, cursor])

  useEffect(() => {
    setDismissed(false)
  }, [token?.start, token?.query])

  useEffect(() => {
    if (!token || !workspacePath || !window.vyotiq?.workspaceSuggestPaths) {
      setPaths([])
      return
    }
    const reqId = ++reqIdRef.current
    setLoading(true)
    const handle = window.setTimeout(() => {
      void window.vyotiq
        .workspaceSuggestPaths({
          workspacePath,
          query: token.query,
          maxResults: 24
        })
        .then((res) => {
          if (reqId !== reqIdRef.current) return
          if (res.ok) setPaths(res.data.paths)
          else setPaths([])
        })
        .catch(() => {
          if (reqId === reqIdRef.current) setPaths([])
        })
        .finally(() => {
          if (reqId === reqIdRef.current) setLoading(false)
        })
    }, 80)
    return () => {
      window.clearTimeout(handle)
    }
  }, [token?.query, token?.start, workspacePath])

  useEffect(() => {
    setActiveIndex(0)
  }, [paths])

  const open = Boolean(token && !dismissed && (loading || paths.length > 0 || token.query === ''))

  const accept = useCallback(
    (path: string): { nextText: string; nextCursor: number } | null => {
      if (!token) return null
      const insert = `@${path}`
      const nextText = text.slice(0, token.start) + insert + text.slice(token.end)
      return { nextText, nextCursor: token.start + insert.length }
    },
    [text, token]
  )

  return {
    open,
    paths,
    loading,
    activeIndex,
    setActiveIndex,
    dismiss: () => setDismissed(true),
    accept,
    token
  }
}
