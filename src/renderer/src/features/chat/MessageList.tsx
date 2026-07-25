import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { Icon } from '../../shared/icons'
import { IconButton, ImageChip, MarkdownContent, cn } from '../../shared/ui'
import { copyText } from '../../shared/ui/copyText'
import type { UiItem } from '@shared/transcript'
import { CHAT_GUTTER } from '../../shared/utils/layout'
import { formatDisplayTime, formatElapsed } from '@shared/timeFormat'
import { prefersReducedMotion } from '../../shared/utils/motion'
import { ToolRow } from './ToolRow'

const NEAR_BOTTOM_PX = 80
const SCROLL_PERSIST_MS = 120

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function groupElapsedLabel(
  timing: { startedAt: number; endedAt?: number } | undefined,
  now: number,
  live: boolean
): string | null {
  if (!timing) return null
  const end = timing.endedAt ?? (live ? now : null)
  if (end == null) return null
  const ms = Math.max(0, end - timing.startedAt)
  return `Worked for ${formatElapsed(ms)}`
}

function MessageTimestamp({
  at,
  showTimestamps
}: {
  at?: string
  showTimestamps: boolean
}) {
  if (!at) return null
  const label = formatDisplayTime(at)
  if (!label) return null
  return (
    <time
      dateTime={at}
      title={at}
      className={cn(
        'text-xs text-muted tabular-nums',
        showTimestamps
          ? 'mt-0.5'
          : 'pointer-events-none absolute -top-4 left-0 opacity-0 vy-transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
      )}
    >
      {label}
    </time>
  )
}

function MessageActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    return () => {
      for (const id of timersRef.current) window.clearTimeout(id)
      timersRef.current = []
    }
  }, [])

  const schedule = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id)
      fn()
    }, ms)
    timersRef.current.push(id)
  }

  return (
    <div className="mt-0.5 flex items-center gap-0.5 text-border-strong vy-transition group-hover:text-muted group-focus-within:text-muted">
      <IconButton
        icon={copied ? 'check' : 'copy'}
        label={copied ? 'Copied' : copyError ? 'Copy failed' : 'Copy'}
        size="sm"
        onClick={() => {
          void copyText(content).then((ok) => {
            if (ok) {
              setCopied(true)
              setCopyError(false)
              schedule(() => setCopied(false), 1200)
            } else {
              setCopyError(true)
              schedule(() => setCopyError(false), 1600)
            }
          })
        }}
      />
    </div>
  )
}

function ImageLightbox({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-4 top-4 inline-grid size-8 place-items-center rounded-full bg-black/50 text-white vy-transition hover:bg-black/70"
        aria-label="Close image preview"
        onClick={onClose}
      >
        <Icon name="close" size={14} />
      </button>
      <img
        src={url}
        alt={label}
        className="max-h-[min(90vh,900px)] max-w-[min(92vw,1200px)] rounded-md object-contain shadow-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

export function MessageList({
  items,
  running,
  runStartedAt,
  showTimestamps = false,
  restoreScrollTop,
  scrollRestoreToken,
  onScrollTopChange
}: {
  items: UiItem[]
  running: boolean
  runStartedAt: number | null
  showTimestamps?: boolean
  restoreScrollTop?: number
  scrollRestoreToken?: number
  onScrollTopChange?: (scrollTop: number) => void
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appliedRestoreRef = useRef<number | null>(null)
  const restoreScrollTopRef = useRef(restoreScrollTop ?? 0)
  const restorePendingRef = useRef(Boolean(restoreScrollTop && restoreScrollTop > 0))
  const pinnedToBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const scrollPersistTimerRef = useRef<number | null>(null)
  const autoScrollRafRef = useRef<number | null>(null)
  const [scrollRestored, setScrollRestored] = useState(
    () => !restoreScrollTop || restoreScrollTop <= 0
  )
  const [now, setNow] = useState(() => Date.now())
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null)

  restoreScrollTopRef.current = restoreScrollTop ?? 0

  useLayoutEffect(() => {
    appliedRestoreRef.current = null
    const top = restoreScrollTopRef.current
    restorePendingRef.current = Boolean(top && top > 0)
    setScrollRestored(!top || top <= 0)
  }, [scrollRestoreToken])

  useLayoutEffect(() => {
    const top = restoreScrollTopRef.current
    if (!top || top <= 0) {
      restorePendingRef.current = false
      setScrollRestored(true)
      pinnedToBottomRef.current = true
      return
    }
    const el = containerRef.current
    if (!el) return
    const id = window.requestAnimationFrame(() => {
      programmaticScrollRef.current = true
      el.scrollTop = top
      const contentTall = el.scrollHeight > el.clientHeight + NEAR_BOTTOM_PX
      pinnedToBottomRef.current = contentTall && distanceFromBottom(el) < NEAR_BOTTOM_PX
      appliedRestoreRef.current = scrollRestoreToken ?? 0
      setScrollRestored(true)
      if (contentTall) restorePendingRef.current = false
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    })
    return () => window.cancelAnimationFrame(id)
  }, [scrollRestoreToken, items])

  const hasLiveGroup = useMemo(
    () => items.some((i) => i.kind === 'tool' && i.groupTiming && !i.groupTiming.endedAt),
    [items]
  )

  useEffect(() => {
    return () => {
      if (scrollPersistTimerRef.current) window.clearTimeout(scrollPersistTimerRef.current)
      if (autoScrollRafRef.current) window.cancelAnimationFrame(autoScrollRafRef.current)
    }
  }, [])

  const followTail = useCallback((behavior: ScrollBehavior) => {
    const el = containerRef.current
    if (!el) return
    programmaticScrollRef.current = true
    if (behavior === 'auto') {
      el.scrollTop = el.scrollHeight
    } else {
      endRef.current?.scrollIntoView?.({ behavior, block: 'end' })
    }
    pinnedToBottomRef.current = true
    window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
  }, [])

  useEffect(() => {
    if (!scrollRestored) return
    if (restorePendingRef.current) return
    if (!pinnedToBottomRef.current) return

    if (autoScrollRafRef.current) window.cancelAnimationFrame(autoScrollRafRef.current)
    autoScrollRafRef.current = window.requestAnimationFrame(() => {
      autoScrollRafRef.current = null
      const useInstant = running || hasLiveGroup || prefersReducedMotion()
      followTail(useInstant ? 'auto' : 'smooth')
    })
  }, [items, running, scrollRestored, hasLiveGroup, followTail])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!scrollRestored || restorePendingRef.current || !pinnedToBottomRef.current) return
      if (autoScrollRafRef.current) window.cancelAnimationFrame(autoScrollRafRef.current)
      autoScrollRafRef.current = window.requestAnimationFrame(() => {
        autoScrollRafRef.current = null
        followTail('auto')
      })
    })
    ro.observe(el)
    const inner = el.firstElementChild
    if (inner) ro.observe(inner)
    return () => ro.disconnect()
  }, [followTail, scrollRestored])

  const handleScroll = useCallback(
    (scrollTop: number) => {
      const el = containerRef.current
      if (el && !programmaticScrollRef.current) {
        pinnedToBottomRef.current = distanceFromBottom(el) < NEAR_BOTTOM_PX
      }
      if (!onScrollTopChange) return
      if (scrollPersistTimerRef.current) window.clearTimeout(scrollPersistTimerRef.current)
      scrollPersistTimerRef.current = window.setTimeout(() => {
        scrollPersistTimerRef.current = null
        onScrollTopChange(scrollTop)
      }, SCROLL_PERSIST_MS)
    },
    [onScrollTopChange]
  )

  useEffect(() => {
    if (!running && !hasLiveGroup) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running, hasLiveGroup])

  const toolItems = useMemo(() => items.filter((i) => i.kind === 'tool'), [items])

  useEffect(() => {
    const liveGroupIds: string[] = []
    let idx = 0
    while (idx < items.length) {
      const entry = items[idx]
      if (entry.kind !== 'tool') {
        idx++
        continue
      }
      const groupId = entry.id
      const timing = entry.groupTiming
      const live = Boolean(timing && !timing.endedAt && running)
      while (idx < items.length && items[idx].kind === 'tool') idx++
      if (live) liveGroupIds.push(groupId)
    }
    if (liveGroupIds.length === 0) return
    setOpenGroups((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of liveGroupIds) {
        if (next[id] === undefined) {
          next[id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [items, running])

  const isGroupOpen = (groupId: string, live: boolean): boolean =>
    openGroups[groupId] ?? live

  const toggleGroup = (groupId: string, live: boolean): void => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? live)
    }))
  }

  const preToolElapsed =
    running && toolItems.length === 0 && runStartedAt
      ? `Worked for ${formatElapsed(Math.max(0, now - runStartedAt))}`
      : null

  const blocks: ReactNode[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]
    if (item.kind === 'message' && item.role === 'user') {
      blocks.push(
        <div key={item.id} className="group relative flex flex-col items-start gap-0.5">
          <MessageTimestamp at={item.at} showTimestamps={showTimestamps} />
          <div className="max-w-[min(680px,94%)] rounded-bubble bg-user-bubble px-3.5 py-2.5 text-sm leading-relaxed tracking-[-0.006em] text-fg [overflow-wrap:anywhere] animate-fade-in">
            {item.content ? (
              <MarkdownContent content={item.content} streaming={false} />
            ) : null}
            {item.images?.length ? (
              <div
                className={cn(
                  'flex flex-wrap gap-1.5',
                  item.content ? 'mt-2' : null
                )}
              >
                {item.images.map((url, imageIndex) => (
                  <ImageChip
                    key={`${item.id}-${imageIndex}`}
                    url={url}
                    label={`Image ${imageIndex + 1}`}
                    onClick={() => setLightbox({ url, label: `Image ${imageIndex + 1}` })}
                  />
                ))}
              </div>
            ) : null}
          </div>
          {item.content ? <MessageActions content={item.content} /> : null}
        </div>
      )
      i++
      continue
    }

    if (item.kind === 'tool') {
      const start = i
      while (i < items.length && items[i].kind === 'tool') i++
      const slice = items.slice(start, i) as Extract<UiItem, { kind: 'tool' }>[]
      const groupId = slice[0].id
      const timing = slice[0].groupTiming
      const live = Boolean(timing && !timing.endedAt && running)
      const groupOpen = isGroupOpen(groupId, live)
      const elapsedLabel = groupElapsedLabel(timing, now, live)
      const groupAt = slice[0].at
      const groupLabel =
        elapsedLabel ?? `${slice.length} tool${slice.length === 1 ? '' : 's'}`

      blocks.push(
        <div key={`tools-${groupId}`} className="group flex max-w-[720px] flex-col gap-0">
          <button
            type="button"
            className="mb-0.5 inline-flex items-center gap-1 self-start text-xs tracking-[var(--vy-tracking)] text-muted vy-transition hover:text-fg"
            aria-expanded={groupOpen}
            aria-controls={`tool-group-${groupId}`}
            onClick={() => toggleGroup(groupId, live)}
          >
            <span>{groupLabel}</span>
            {showTimestamps && groupAt ? (
              <time className="text-muted tabular-nums" dateTime={groupAt} title={groupAt}>
                · {formatDisplayTime(groupAt)}
              </time>
            ) : null}
            <Icon
              name="chevron"
              size={11}
              className={cn(
                'text-muted vy-transition',
                groupOpen ? 'rotate-0' : '-rotate-90'
              )}
            />
          </button>
          <div id={`tool-group-${groupId}`}>
            {groupOpen ? (
              slice.map((t) => <ToolRow key={t.id} tool={t.tool} />)
            ) : (
              <p className="m-0 text-xs text-muted">
                {slice.length} tool{slice.length === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>
      )
      continue
    }

    blocks.push(
      <div key={item.id} className="group relative flex max-w-[720px] flex-col items-start gap-0.5">
        <MessageTimestamp at={item.at} showTimestamps={showTimestamps} />
        <MarkdownContent content={item.content} streaming={item.streaming} />
        {!item.streaming && item.content ? <MessageActions content={item.content} /> : null}
      </div>
    )
    i++
  }

  if (preToolElapsed) {
    blocks.push(
      <p key="working" className="m-0 text-xs text-muted animate-fade-in">
        {preToolElapsed}
      </p>
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-auto overflow-anchor-none py-2.5 sm:py-3',
          CHAT_GUTTER
        )}
        aria-live="polite"
        aria-relevant="additions"
        aria-atomic="false"
        onScroll={(e) => handleScroll(e.currentTarget.scrollTop)}
      >
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2.5">
          {blocks}
          <div ref={endRef} />
        </div>
      </div>
      {lightbox ? (
        <ImageLightbox
          url={lightbox.url}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </>
  )
}
