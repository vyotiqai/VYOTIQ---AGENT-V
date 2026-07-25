import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import type { UiItem } from '@shared/transcript'
import type { ToolApprovalDecision } from '@shared/ipc'
import {
  CHAT_COLUMN,
  CHAT_GUTTER,
  TRANSCRIPT_ROW_GAP,
  TRANSCRIPT_TURN_GAP
} from '@renderer/lib/utils/layout'
import {
  buildTranscriptRows,
  estimateTranscriptRowSize,
  isTurnWorkRow,
  rowLeadingGap,
  type TranscriptRow
} from '../utils/transcriptRows'
import { ChangeSummary } from './ChangeSummary'
import { MessageFooter } from './MessageFooter'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolApprovalCard } from './ToolApprovalCard'
import { ToolCard } from './ToolCard'
import { ToolGroup } from './ToolGroup'
import { TurnSummary } from './TurnSummary'
import { UserPrompt } from './UserPrompt'
import { MarkdownContent } from '@renderer/lib/ui'

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

/**
 * Spacing lives on the row itself (padding, not margin) so virtualized rows —
 * which are absolutely positioned and measured by offsetHeight — get the exact
 * same rhythm as the plain flow layout.
 */
function rowSpacingClass(row: TranscriptRow): string {
  return cn(TRANSCRIPT_ROW_GAP, rowLeadingGap(row) > 0 && TRANSCRIPT_TURN_GAP)
}

function isRowStreaming(row: TranscriptRow): boolean {
  if (row.kind === 'text') return row.item.streaming === true
  if (row.kind === 'thinking') return row.item.thinkingStreaming === true
  return false
}

const TranscriptRowBlock = memo(function TranscriptRowBlock({
  row,
  onImageClick,
  onLoadToolContent,
  onThinkingToggle,
  onToolToggle,
  onGroupToggle,
  onTurnToggle,
  onApprovalDecision,
  turnCollapsed = false,
  showThinking = true
}: {
  row: TranscriptRow
  onImageClick: (url: string, label: string) => void
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onThinkingToggle?: (messageId: string, expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onGroupToggle?: (anchorToolCallId: string, expanded: boolean) => void
  onTurnToggle?: (turnIndex: number) => void
  onApprovalDecision?: (requestId: string, decision: ToolApprovalDecision) => void
  turnCollapsed?: boolean
  showThinking?: boolean
}) {
  if (row.kind === 'user') {
    return <UserPrompt item={row.item} onImageClick={onImageClick} />
  }

  if (row.kind === 'turn') {
    return (
      <TurnSummary
        span={row.span}
        collapsed={turnCollapsed}
        onToggle={() => onTurnToggle?.(row.turnIndex)}
      />
    )
  }

  if (row.kind === 'thinking') {
    if (!showThinking) return null
    return (
      <ThinkingBlock
        content={row.item.thinking ?? ''}
        streaming={row.item.thinkingStreaming}
        expanded={row.item.thinkingExpanded}
        onToggle={(next) => onThinkingToggle?.(row.item.id, next)}
      />
    )
  }

  if (row.kind === 'text') {
    return (
      <div className="group/message">
        <MarkdownContent content={row.item.content} streaming={row.item.streaming} />
        {row.final && !row.item.streaming ? (
          <MessageFooter content={row.item.content} at={row.item.at} />
        ) : null}
      </div>
    )
  }

  if (row.kind === 'changes') {
    return <ChangeSummary files={row.files} />
  }

  if (row.kind === 'approval') {
    return <ToolApprovalCard approval={row.approval} onDecide={onApprovalDecision} />
  }

  if (row.kind === 'activity') {
    const expandedToolIds = new Set(
      row.tools.filter((tool) => tool.toolExpanded).map((tool) => tool.id)
    )
    const anchor = row.tools[0]!
    return (
      <ToolGroup
        tools={row.tools}
        expandedToolIds={expandedToolIds}
        groupExpanded={anchor.groupExpanded}
        onGroupToggle={
          onGroupToggle ? (expanded) => onGroupToggle(anchor.id, expanded) : undefined
        }
        onToolToggle={onToolToggle}
        onLoadFullContent={onLoadToolContent}
      />
    )
  }

  return (
    <ToolCard
      item={row.item}
      expanded={row.item.toolExpanded}
      // Without a host that persists the choice the card owns its own state,
      // so it still opens instead of swallowing the click.
      onToggle={onToolToggle ? (next) => onToolToggle(row.item.id, next) : undefined}
      onLoadFullContent={onLoadToolContent}
    />
  )
})

export function MessageList({
  items,
  reserveComposerSpace,
  restoreScrollTop,
  scrollRestoreToken,
  onScrollTopChange,
  onLoadToolContent,
  onThinkingToggle,
  onToolToggle,
  onGroupToggle,
  onApprovalDecision,
  showThinking = true
}: {
  items: UiItem[]
  reserveComposerSpace?: boolean
  restoreScrollTop?: number
  scrollRestoreToken?: number
  onScrollTopChange?: (scrollTop: number) => void
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onThinkingToggle?: (messageId: string, expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onGroupToggle?: (anchorToolCallId: string, expanded: boolean) => void
  onApprovalDecision?: (requestId: string, decision: ToolApprovalDecision) => void
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
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(() => new Set())
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

  // Dropping out of virtual mode while streaming re-rendered every row of the
  // transcript on every delta, which is the exact case virtualization exists for.
  const useVirtual = virtualized
  const itemsStructuralKey = useMemo(() => structuralKey(items), [items])
  const allRows = useMemo(() => buildTranscriptRows(items), [items])
  const displayRows = useMemo(() => {
    let rows = allRows
    if (!showThinking) rows = rows.filter((row) => row.kind !== 'thinking')
    if (collapsedTurns.size === 0) return rows
    return rows.filter((row) => !(collapsedTurns.has(row.turnIndex) && isTurnWorkRow(row)))
  }, [allRows, collapsedTurns, showThinking])
  const virtualRows = useMemo(() => (useVirtual ? displayRows : []), [displayRows, useVirtual])
  const streamingRowId = useMemo(() => {
    for (let i = displayRows.length - 1; i >= 0; i--) {
      const row = displayRows[i]!
      if ((row.kind === 'text' || row.kind === 'thinking') && isRowStreaming(row)) return row.id
    }
    return null
  }, [displayRows])
  const virtualLiveAnnouncement = useMemo(() => {
    if (!useVirtual || !streamingRowId) return ''
    const row = displayRows.find((r) => r.id === streamingRowId)
    if (!row) return ''
    if (row.kind === 'text') return row.item.content.trim()
    if (row.kind === 'thinking') return row.item.thinking?.trim() ?? ''
    return ''
  }, [useVirtual, streamingRowId, displayRows])

  restoreScrollTopRef.current = restoreScrollTop ?? 0

  const onImageClick = useCallback((url: string, label: string) => {
    setLightbox({ url, label })
  }, [])

  const onTurnToggle = useCallback((turnIndex: number) => {
    setCollapsedTurns((prev) => {
      const next = new Set(prev)
      if (!next.delete(turnIndex)) next.add(turnIndex)
      return next
    })
  }, [])

  const streamingRowElRef = useRef<HTMLDivElement | null>(null)

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    enabled: useVirtual,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => estimateTranscriptRowSize(virtualRows[index]!),
    overscan: 8,
    getItemKey: (index) => virtualRows[index]?.id ?? index
  })

  const measureStreamingRow = useCallback(
    (el: HTMLDivElement | null) => {
      streamingRowElRef.current = el
      virtualizer.measureElement(el)
    },
    [virtualizer]
  )

  // The streaming row grows on every delta. ResizeObserver-driven measurement
  // lands a frame late, so remeasure it directly and leave every other row on
  // the cached size.
  useLayoutEffect(() => {
    const el = streamingRowElRef.current
    if (!useVirtual || !el) return
    virtualizer.measureElement(el)
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

  const columnClass = cn('flex w-full flex-col', CHAT_COLUMN)

  const dockReserveStyle = reserveComposerSpace
    ? ({ paddingBottom: 'var(--vy-dock-h, 8rem)' } as const)
    : undefined

  const simpleBlocks = useMemo(() => {
    if (useVirtual) return []
    return displayRows.map((row) => (
      <div key={row.id} className={rowSpacingClass(row)}>
        <TranscriptRowBlock
          row={row}
          onImageClick={onImageClick}
          onLoadToolContent={onLoadToolContent}
          onThinkingToggle={onThinkingToggle}
          onToolToggle={onToolToggle}
          onGroupToggle={onGroupToggle}
          onTurnToggle={onTurnToggle}
          onApprovalDecision={onApprovalDecision}
          turnCollapsed={collapsedTurns.has(row.turnIndex)}
          showThinking={showThinking}
        />
      </div>
    ))
  }, [
    useVirtual,
    displayRows,
    collapsedTurns,
    onImageClick,
    onLoadToolContent,
    onThinkingToggle,
    onToolToggle,
    onGroupToggle,
    onTurnToggle,
    onApprovalDecision,
    showThinking
  ])

  return (
    <>
      {useVirtual ? (
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {virtualLiveAnnouncement}
        </div>
      ) : null}
      <div
        ref={containerRef}
        data-transcript-scroll
        className={cn('flex min-h-0 flex-1 flex-col overflow-auto pt-4', CHAT_GUTTER)}
        style={dockReserveStyle}
        // Virtual rows mount on scroll, so announcing additions there would read
        // the transcript back as the user scrolls. Only announce real appends.
        aria-live={useVirtual ? undefined : 'polite'}
        aria-relevant={useVirtual ? undefined : 'additions'}
        aria-atomic={useVirtual ? undefined : 'false'}
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
              const streaming = row.id === streamingRowId
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={streaming ? measureStreamingRow : virtualizer.measureElement}
                  className={rowSpacingClass(row)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <TranscriptRowBlock
                    row={row}
                    onImageClick={onImageClick}
                    onLoadToolContent={onLoadToolContent}
                    onThinkingToggle={onThinkingToggle}
                    onToolToggle={onToolToggle}
                    onGroupToggle={onGroupToggle}
                    onTurnToggle={onTurnToggle}
                    onApprovalDecision={onApprovalDecision}
                    turnCollapsed={collapsedTurns.has(row.turnIndex)}
                    showThinking={showThinking}
                  />
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
