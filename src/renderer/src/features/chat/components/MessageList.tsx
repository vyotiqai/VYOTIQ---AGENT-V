import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import type { UiItem } from '@shared/transcript'
import type { ToolApprovalDecision } from '@shared/ipc'
import {
  CHAT_COLUMN,
  CHAT_GUTTER,
  TRANSCRIPT_ROW_GAP,
  TRANSCRIPT_TURN_GAP,
  TRANSCRIPT_WORK_ROW_GAP
} from '@renderer/lib/utils/layout'
import {
  buildTranscriptRows,
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

/** Minimum pin slack when no dock reserve is known yet. */
const NEAR_BOTTOM_MIN_PX = 80

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function nearBottomThreshold(dockReservePx?: number): number {
  if (dockReservePx == null || dockReservePx <= 0) return NEAR_BOTTOM_MIN_PX
  return Math.max(NEAR_BOTTOM_MIN_PX, dockReservePx)
}

function structuralKey(items: UiItem[]): string {
  return items
    .map((item) => (item.kind === 'tool' ? `${item.id}:${item.tool.status}` : item.id))
    .join('|')
}

function ImageLightbox({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      // Single focusable control in the dialog — keep focus trapped on Close.
      e.preventDefault()
      closeRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocusRef.current?.focus?.()
    }
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
        ref={closeRef}
        type="button"
        className="absolute right-4 top-4 inline-grid size-8 place-items-center rounded-full bg-black/50 text-white vy-transition hover:bg-black/70"
        aria-label="Close image preview"
        onClick={onClose}
      >
        <Icon name="close" size={16} />
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

/** Spacing as padding (not margin) so row rhythm stays consistent. */
function rowSpacingClass(row: TranscriptRow): string {
  if (row.kind === 'turn') {
    return cn('pt-1', TRANSCRIPT_ROW_GAP)
  }
  const gap =
    row.kind === 'activity' || row.kind === 'thinking' || row.kind === 'card'
      ? TRANSCRIPT_WORK_ROW_GAP
      : TRANSCRIPT_ROW_GAP
  return cn(gap, rowLeadingGap(row) > 0 && TRANSCRIPT_TURN_GAP)
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
  showThinking = true,
  mcpServerNames
}: {
  row: TranscriptRow
  onImageClick: (url: string, label: string) => void
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onThinkingToggle?: (messageId: string, expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onGroupToggle?: (anchorToolCallId: string, expanded: boolean) => void
  onTurnToggle?: (turnIndex: number) => void
  onApprovalDecision?: (requestId: string, decision: ToolApprovalDecision) => void | Promise<void>
  turnCollapsed?: boolean
  showThinking?: boolean
  mcpServerNames?: ReadonlyMap<string, string>
}) {
  if (row.kind === 'user') {
    return <UserPrompt item={row.item} onImageClick={onImageClick} />
  }

  if (row.kind === 'turn') {
    return (
      <TurnSummary
        span={row.span}
        collapsed={turnCollapsed}
        panelId={`turn-work-${row.turnIndex}`}
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
        mcpServerNames={mcpServerNames}
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
      mcpServerNames={mcpServerNames}
    />
  )
})

export function MessageList({
  items,
  reserveComposerSpace,
  dockReservePx,
  restoreScrollTop,
  scrollRestoreToken,
  onScrollTopChange,
  onLoadToolContent,
  onThinkingToggle,
  onToolToggle,
  onGroupToggle,
  onTurnToggle,
  onApprovalDecision,
  collapsedTurns,
  showThinking = true,
  mcpServerNames,
  pendingRun = false,
  running = false,
  transcriptLoading = false
}: {
  items: UiItem[]
  reserveComposerSpace?: boolean
  /** Measured composer dock reserve (padding + fade); drives pin threshold. */
  dockReservePx?: number
  restoreScrollTop?: number
  scrollRestoreToken?: number
  onScrollTopChange?: (scrollTop: number) => void
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onThinkingToggle?: (messageId: string, expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onGroupToggle?: (anchorToolCallId: string, expanded: boolean) => void
  onTurnToggle?: (turnIndex: number) => void
  onApprovalDecision?: (requestId: string, decision: ToolApprovalDecision) => void | Promise<void>
  /** Persisted turn-summary collapse state from the chat stream controller. */
  collapsedTurns?: ReadonlySet<number>
  showThinking?: boolean
  mcpServerNames?: ReadonlyMap<string, string>
  pendingRun?: boolean
  running?: boolean
  /** True while the selected chat transcript is still loading. */
  transcriptLoading?: boolean
}) {
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
  const collapsedTurnSet = useMemo(
    () => collapsedTurns ?? new Set<number>(),
    [collapsedTurns]
  )
  const prevStructuralKeyRef = useRef<string | null>(null)

  const itemsStructuralKey = useMemo(() => structuralKey(items), [items])
  const allRows = useMemo(
    () => buildTranscriptRows(items, { pendingRun, running, showThinking }),
    [items, pendingRun, running, showThinking]
  )
  const displayRows = useMemo(() => {
    if (collapsedTurnSet.size === 0) return allRows
    return allRows.filter((row) => !(collapsedTurnSet.has(row.turnIndex) && isTurnWorkRow(row)))
  }, [allRows, collapsedTurnSet])

  const nearBottomPx = nearBottomThreshold(dockReservePx)
  const nearBottomPxRef = useRef(nearBottomPx)
  nearBottomPxRef.current = nearBottomPx

  restoreScrollTopRef.current = restoreScrollTop ?? 0

  const onImageClick = useCallback((url: string, label: string) => {
    setLightbox({ url, label })
  }, [])
  const closeLightbox = useCallback(() => setLightbox(null), [])

  const handleTurnToggle = useCallback(
    (turnIndex: number) => {
      onTurnToggle?.(turnIndex)
    },
    [onTurnToggle]
  )

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
      el.scrollTop = top
      const contentTall = el.scrollHeight > el.clientHeight + nearBottomPxRef.current
      pinnedToBottomRef.current = !contentTall || distanceFromBottom(el) < nearBottomPxRef.current
      appliedRestoreRef.current = scrollRestoreToken ?? 0
      setScrollRestored(true)
      restorePendingRef.current = false
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }

    const id = window.requestAnimationFrame(applyRestore)
    return () => window.cancelAnimationFrame(id)
  }, [scrollRestoreToken])

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
      el.scrollTop = top
      const contentTall = el.scrollHeight > el.clientHeight + nearBottomPxRef.current
      pinnedToBottomRef.current = !contentTall || distanceFromBottom(el) < nearBottomPxRef.current
      restorePendingRef.current = false
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    })
    ro.observe(el)
    const inner = el.firstElementChild
    if (inner) ro.observe(inner)
    return () => ro.disconnect()
  }, [scrollRestoreToken])

  useEffect(() => {
    return () => {
      if (autoScrollRafRef.current) window.cancelAnimationFrame(autoScrollRafRef.current)
    }
  }, [])

  const followTail = useCallback((behavior: ScrollBehavior) => {
    const el = containerRef.current
    if (!el) return
    programmaticScrollRef.current = true
    // Scroll to the true end so CSS paddingBottom (--vy-dock-h) keeps the last
    // row above the floating composer.
    const top = el.scrollHeight
    if (behavior === 'smooth' && typeof el.scrollTo === 'function') {
      el.scrollTo({ top, behavior: 'smooth' })
    } else {
      el.scrollTop = top
    }
    pinnedToBottomRef.current = true
    window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
  }, [])

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

  // Dock reserve (padding) can grow without resizing the scrollport; re-pin when pinned.
  useLayoutEffect(() => {
    if (!reserveComposerSpace || dockReservePx == null) return
    if (!scrollRestored || restorePendingRef.current || !pinnedToBottomRef.current) return
    const el = containerRef.current
    if (el && distanceFromBottom(el) <= 1) return
    followTail('auto')
  }, [dockReservePx, reserveComposerSpace, followTail, scrollRestored])

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
        pinnedToBottomRef.current = distanceFromBottom(el) < nearBottomPxRef.current
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

  const blocks = useMemo(() => {
    const turnWorkPanelAssigned = new Set<number>()
    return displayRows.map((row) => {
      const turnPanelId =
        isTurnWorkRow(row) && !turnWorkPanelAssigned.has(row.turnIndex)
          ? `turn-work-${row.turnIndex}`
          : undefined
      if (turnPanelId) turnWorkPanelAssigned.add(row.turnIndex)

      return (
        <div key={row.id} id={turnPanelId} className={rowSpacingClass(row)}>
          <TranscriptRowBlock
            row={row}
            onImageClick={onImageClick}
            onLoadToolContent={onLoadToolContent}
            onThinkingToggle={onThinkingToggle}
            onToolToggle={onToolToggle}
            onGroupToggle={onGroupToggle}
            onTurnToggle={handleTurnToggle}
            onApprovalDecision={onApprovalDecision}
            turnCollapsed={collapsedTurnSet.has(row.turnIndex)}
            showThinking={showThinking}
            mcpServerNames={mcpServerNames}
          />
        </div>
      )
    })
  }, [
      displayRows,
      collapsedTurnSet,
      onImageClick,
      onLoadToolContent,
      onThinkingToggle,
      onToolToggle,
      onGroupToggle,
      handleTurnToggle,
      onApprovalDecision,
      showThinking,
      mcpServerNames
  ])

  return (
    <>
      <div
        ref={containerRef}
        data-transcript-scroll
        className={cn('flex min-h-0 flex-1 flex-col overflow-auto pt-4', CHAT_GUTTER)}
        style={dockReserveStyle}
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic="false"
        onScroll={(e) => handleScroll(e.currentTarget.scrollTop)}
      >
        <div className={columnClass} data-chat-column>
          {transcriptLoading && items.length === 0 ? (
            <div
              className="flex min-h-[12rem] flex-col items-center justify-center gap-2 text-sm text-muted"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <Icon name="loader" size={16} className="motion-safe:animate-spin" />
              <span>Loading chat…</span>
            </div>
          ) : (
            blocks
          )}
        </div>
      </div>
      {lightbox ? (
        <ImageLightbox
          url={lightbox.url}
          label={lightbox.label}
          onClose={closeLightbox}
        />
      ) : null}
    </>
  )
}
