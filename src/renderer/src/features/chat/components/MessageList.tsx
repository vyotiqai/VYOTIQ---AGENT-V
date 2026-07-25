import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Icon } from '@renderer/lib/icons'
import { ImageChip, MarkdownContent, cn } from '@renderer/lib/ui'
import type { UiItem } from '@shared/transcript'
import { formatDisplayTime } from '@shared/utils/timeFormat'
import { CHAT_COLUMN, CHAT_GUTTER } from '@renderer/lib/utils/layout'
import { buildVirtualRows, estimateVirtualRowSize, type VirtualRow } from '../utils/virtualRows'
import { ToolRow } from './ToolRow'
import { ToolGroup } from './ToolGroup'
import { ThinkingBlock } from './ThinkingBlock'

const NEAR_BOTTOM_PX = 80
/** Virtualize long transcripts to avoid O(n) renders per stream delta. */
export const VIRTUALIZE_THRESHOLD = 40
/** Stay virtualized until count drops below this (hysteresis avoids mode flips). */
export const VIRTUALIZE_RELEASE_THRESHOLD = 30

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function structuralKey(items: UiItem[]): string {
  return items
    .map((item) => (item.kind === 'tool' ? `${item.id}:${item.tool.status}` : item.id))
    .join('|')
}

function TimestampSlot({ at, className }: { at?: string; className?: string }) {
  return (
    <time
      className={cn(
        'mb-1 block h-[14px] text-[10px] leading-[14px] text-tertiary',
        !at && 'invisible',
        className
      )}
      dateTime={at}
    >
      {at ? formatDisplayTime(at) : '\u00a0'}
    </time>
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

const MessageListItem = memo(function MessageListItem({
  item,
  onImageClick,
  onLoadToolContent,
  onThinkingToggle,
  onToolToggle,
  showThinking = true
}: {
  item: UiItem
  onImageClick: (url: string, label: string) => void
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onThinkingToggle?: (messageId: string, expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  showThinking?: boolean
}) {
  if (item.kind === 'message' && item.role === 'user') {
    return (
      <div className="flex flex-col items-start">
        <TimestampSlot at={item.at} />
        <div className="max-w-[min(680px,94%)] rounded-bubble bg-user-bubble px-3.5 py-2.5 text-sm leading-relaxed tracking-[-0.006em] text-fg [overflow-wrap:anywhere]">
          {item.content ? <MarkdownContent content={item.content} streaming={false} /> : null}
          {item.images?.length ? (
            <div className={cn('flex flex-wrap gap-1.5', item.content ? 'mt-2' : null)}>
              {item.images.map((url, imageIndex) => (
                <ImageChip
                  key={`${item.id}-${imageIndex}`}
                  url={url}
                  label={`Image ${imageIndex + 1}`}
                  onClick={() => onImageClick(url, `Image ${imageIndex + 1}`)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (item.kind === 'tool') {
    return (
      <div className="flex max-w-[720px] flex-col gap-0.5">
        <TimestampSlot at={item.at} className="px-2" />
        <ToolRow
          tool={item.tool}
          expanded={item.toolExpanded}
          onToggle={(next) => onToolToggle?.(item.id, next)}
          onLoadFullContent={onLoadToolContent}
        />
      </div>
    )
  }

  return (
    <div className="flex max-w-[720px] flex-col items-start">
      <TimestampSlot at={item.at} />
      {showThinking && (item.thinking || item.thinkingStreaming) ? (
        <ThinkingBlock
          content={item.thinking ?? ''}
          streaming={item.thinkingStreaming}
          expanded={item.thinkingExpanded}
          onToggle={(next) => onThinkingToggle?.(item.id, next)}
        />
      ) : null}
      {item.content ? (
        <MarkdownContent content={item.content} streaming={item.streaming} />
      ) : null}
    </div>
  )
})

function VirtualRowBlock({
  row,
  running,
  onImageClick,
  onLoadToolContent,
  onThinkingToggle,
  onToolToggle,
  showThinking = true
}: {
  row: VirtualRow
  running: boolean
  onImageClick: (url: string, label: string) => void
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onThinkingToggle?: (messageId: string, expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  showThinking?: boolean
}) {
  if (row.kind === 'tool-group') {
    const first = row.tools[0]
    const expandedTool = row.tools.find((tool) => tool.toolExpanded)
    return (
      <div className="flex max-w-[720px] flex-col gap-0.5">
        <TimestampSlot at={first?.at} className="px-2" />
        <ToolGroup
          tools={row.tools}
          groupTiming={first?.groupTiming}
          running={running}
          expandedToolId={expandedTool?.id}
          onToolToggle={onToolToggle}
          onLoadFullContent={onLoadToolContent}
        />
      </div>
    )
  }

  return (
    <MessageListItem
      item={row.item}
      onImageClick={onImageClick}
      onLoadToolContent={onLoadToolContent}
      onThinkingToggle={onThinkingToggle}
      onToolToggle={onToolToggle}
      showThinking={showThinking}
    />
  )
}

export function MessageList({
  items,
  running,
  reserveComposerSpace,
  restoreScrollTop,
  scrollRestoreToken,
  onScrollTopChange,
  onLoadToolContent,
  onThinkingToggle,
  onToolToggle,
  showThinking = true
}: {
  items: UiItem[]
  running: boolean
  reserveComposerSpace?: boolean
  restoreScrollTop?: number
  scrollRestoreToken?: number
  onScrollTopChange?: (scrollTop: number) => void
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onThinkingToggle?: (messageId: string, expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  showThinking?: boolean
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const appliedRestoreRef = useRef<number | null>(null)
  const restoreScrollTopRef = useRef(restoreScrollTop ?? 0)
  const restorePendingRef = useRef(Boolean(restoreScrollTop && restoreScrollTop > 0))
  const pinnedToBottomRef = useRef(true)
  const programmaticScrollRef = useRef(false)
  const autoScrollRafRef = useRef<number | null>(null)
  const [scrollRestored, setScrollRestored] = useState(
    () => !restoreScrollTop || restoreScrollTop <= 0
  )
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null)
  const [virtualized, setVirtualized] = useState(() => items.length >= VIRTUALIZE_THRESHOLD)
  const modeFlipScrollRef = useRef<number | null>(null)
  const prevUseVirtualRef = useRef(items.length >= VIRTUALIZE_THRESHOLD)
  const prevStructuralKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const el = containerRef.current
    let next: boolean | null = null
    if (items.length >= VIRTUALIZE_THRESHOLD) next = true
    else if (items.length < VIRTUALIZE_RELEASE_THRESHOLD) next = false
    if (next === null || next === virtualized) return
    if (el) modeFlipScrollRef.current = el.scrollTop
    setVirtualized(next)
  }, [items.length, virtualized])
  const hasStreamingItems = useMemo(
    () =>
      items.some(
        (item) =>
          item.kind === 'message' && (item.streaming === true || item.thinkingStreaming === true)
      ),
    [items]
  )
  const useVirtual = virtualized && !hasStreamingItems
  const itemsStructuralKey = useMemo(() => structuralKey(items), [items])
  const displayRows = useMemo(() => buildVirtualRows(items), [items])
  const virtualRows = useMemo(
    () => (useVirtual ? displayRows : []),
    [displayRows, useVirtual]
  )

  restoreScrollTopRef.current = restoreScrollTop ?? 0

  const onImageClick = useCallback((url: string, label: string) => {
    setLightbox({ url, label })
  }, [])

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    enabled: useVirtual,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => estimateVirtualRowSize(virtualRows[index]!),
    overscan: 8,
    getItemKey: (index) => virtualRows[index]?.id ?? index
  })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) {
      prevUseVirtualRef.current = useVirtual
      return
    }
    const savedTop = modeFlipScrollRef.current
    if (savedTop != null) {
      modeFlipScrollRef.current = null
      programmaticScrollRef.current = true
      if (useVirtual) {
        virtualizer.scrollToOffset(savedTop, { align: 'start' })
      } else {
        el.scrollTop = savedTop
      }
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    } else if (prevUseVirtualRef.current !== useVirtual) {
      const top = el.scrollTop
      programmaticScrollRef.current = true
      if (useVirtual) {
        virtualizer.scrollToOffset(top, { align: 'start' })
      } else {
        el.scrollTop = top
      }
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }
    prevUseVirtualRef.current = useVirtual
  }, [useVirtual, virtualizer])

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

    const applyRestore = (): void => {
      if (!restorePendingRef.current && appliedRestoreRef.current === (scrollRestoreToken ?? 0)) {
        return
      }
      programmaticScrollRef.current = true
      if (useVirtual) {
        virtualizer.scrollToOffset(top, { align: 'start' })
      } else {
        el.scrollTop = top
      }
      const contentTall = el.scrollHeight > el.clientHeight + NEAR_BOTTOM_PX
      pinnedToBottomRef.current = contentTall && distanceFromBottom(el) < NEAR_BOTTOM_PX
      appliedRestoreRef.current = scrollRestoreToken ?? 0
      setScrollRestored(true)
      if (contentTall) restorePendingRef.current = false
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }

    const id = window.requestAnimationFrame(applyRestore)
    return () => window.cancelAnimationFrame(id)
  }, [scrollRestoreToken, useVirtual, virtualizer])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!restorePendingRef.current) return
      const top = restoreScrollTopRef.current
      if (!top || top <= 0) {
        restorePendingRef.current = false
        return
      }
      programmaticScrollRef.current = true
      if (useVirtual) virtualizer.scrollToOffset(top, { align: 'start' })
      else el.scrollTop = top
      const contentTall = el.scrollHeight > el.clientHeight + NEAR_BOTTOM_PX
      pinnedToBottomRef.current = contentTall && distanceFromBottom(el) < NEAR_BOTTOM_PX
      if (contentTall) restorePendingRef.current = false
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    })
    ro.observe(el)
    const inner = el.firstElementChild
    if (inner) ro.observe(inner)
    return () => ro.disconnect()
  }, [scrollRestoreToken, useVirtual, virtualizer])

  useEffect(() => {
    return () => {
      if (autoScrollRafRef.current) window.cancelAnimationFrame(autoScrollRafRef.current)
    }
  }, [])

  const followTail = useCallback(
    (behavior: ScrollBehavior) => {
      const el = containerRef.current
      if (!el) return
      programmaticScrollRef.current = true
      if (useVirtual && virtualRows.length > 0) {
        virtualizer.scrollToIndex(virtualRows.length - 1, { align: 'end', behavior })
      } else if (behavior === 'auto') {
        el.scrollTop = el.scrollHeight
      } else {
        endRef.current?.scrollIntoView?.({ behavior, block: 'end' })
      }
      pinnedToBottomRef.current = true
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    },
    [virtualRows.length, useVirtual, virtualizer]
  )

  const scheduleTailFollow = useCallback(() => {
    if (autoScrollRafRef.current) window.cancelAnimationFrame(autoScrollRafRef.current)
    autoScrollRafRef.current = window.requestAnimationFrame(() => {
      autoScrollRafRef.current = null
      if (!scrollRestored || restorePendingRef.current || !pinnedToBottomRef.current) return
      const el = containerRef.current
      if (el && distanceFromBottom(el) <= 1) return
      followTail('auto')
    })
  }, [followTail, scrollRestored])

  useEffect(() => {
    if (!scrollRestored || restorePendingRef.current || !pinnedToBottomRef.current) return
    if (prevStructuralKeyRef.current === itemsStructuralKey) return
    prevStructuralKeyRef.current = itemsStructuralKey
    scheduleTailFollow()
  }, [itemsStructuralKey, scheduleTailFollow, scrollRestored])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!scrollRestored || restorePendingRef.current || !pinnedToBottomRef.current) return
      const current = containerRef.current
      if (current && distanceFromBottom(current) <= 1) return
      scheduleTailFollow()
    })
    ro.observe(el)
    const inner = el.firstElementChild
    if (inner) ro.observe(inner)
    return () => ro.disconnect()
  }, [scheduleTailFollow, scrollRestored])

  const handleScroll = useCallback(
    (scrollTop: number) => {
      const el = containerRef.current
      if (el && !programmaticScrollRef.current) {
        pinnedToBottomRef.current = distanceFromBottom(el) < NEAR_BOTTOM_PX
        restorePendingRef.current = false
      }
      onScrollTopChange?.(scrollTop)
    },
    [onScrollTopChange]
  )

  const columnClass = cn(
    'flex w-full flex-col gap-2.5',
    CHAT_COLUMN,
    reserveComposerSpace && 'pb-28'
  )

  const simpleBlocks = useMemo(() => {
    if (useVirtual) return []
    return displayRows.map((row) => (
      <div key={row.id}>
        <VirtualRowBlock
          row={row}
          running={running}
          onImageClick={onImageClick}
          onLoadToolContent={onLoadToolContent}
          onThinkingToggle={onThinkingToggle}
          onToolToggle={onToolToggle}
          showThinking={showThinking}
        />
      </div>
    ))
  }, [
    useVirtual,
    displayRows,
    running,
    onImageClick,
    onLoadToolContent,
    onThinkingToggle,
    onToolToggle,
    showThinking
  ])

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-auto py-2.5 sm:py-3',
          CHAT_GUTTER
        )}
        aria-live="polite"
        aria-relevant="additions"
        aria-atomic="false"
        onScroll={(e) => handleScroll(e.currentTarget.scrollTop)}
      >
        {useVirtual ? (
          <div
            className={cn(columnClass, 'relative')}
            data-chat-column
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = virtualRows[virtualRow.index]
              if (!row) return null
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  {row.kind === 'tool-group' ? (
                    <VirtualRowBlock
                      row={row}
                      running={running}
                      onImageClick={onImageClick}
                      onLoadToolContent={onLoadToolContent}
                      onThinkingToggle={onThinkingToggle}
                      onToolToggle={onToolToggle}
                      showThinking={showThinking}
                    />
                  ) : (
                    <MessageListItem
                      item={row.item}
                      onImageClick={onImageClick}
                      onLoadToolContent={onLoadToolContent}
                      onThinkingToggle={onThinkingToggle}
                      onToolToggle={onToolToggle}
                      showThinking={showThinking}
                    />
                  )}
                </div>
              )
            })}
            <div ref={endRef} />
          </div>
        ) : (
          <div className={columnClass} data-chat-column>
            {simpleBlocks}
            <div ref={endRef} />
          </div>
        )}
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
