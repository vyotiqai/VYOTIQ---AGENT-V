import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import type { UiItem } from '@shared/transcript'
import type { ToolGroupNestedTool } from '../utils/toolGroupAdapter'
import { mapToolGroupProps } from '../utils/toolGroupAdapter'
import { TextShimmer } from './TextShimmer'
import { ToolRow } from './ToolRow'

const CATEGORY_ICONS: Record<ToolGroupNestedTool['category'], IconName> = {
  file: 'file',
  search: 'search',
  command: 'terminal'
}

export type ToolGroupLabels = {
  completeLabel: string
  shimmerLabel: string
  interruptedLabel: string
}

const DEFAULT_LABELS: ToolGroupLabels = {
  completeLabel: 'Explored',
  shimmerLabel: 'Exploring',
  interruptedLabel: 'Exploration interrupted'
}

function formatElapsedTime(ms: number): string {
  if (ms < 1000) return ''
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (remainingSeconds === 0) return `${minutes}m`
  return `${minutes}m ${remainingSeconds}s`
}

function NestedToolRow({
  tool,
  isPending,
  isLastVisible
}: {
  tool: ToolGroupNestedTool
  isPending: boolean
  isLastVisible: boolean
}) {
  const icon = CATEGORY_ICONS[tool.category]
  const rowPending = isPending && isLastVisible && tool.status === 'running'

  return (
    <div className="flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs text-muted">
      <Icon name={icon} size={12} className="shrink-0 text-muted" />
      <span className={cn('shrink-0', tool.status === 'fail' && 'text-danger')}>{tool.title}</span>
      {tool.subtitle ? (
        <span className="min-w-0 truncate text-tertiary" title={tool.subtitle}>
          {tool.subtitle}
        </span>
      ) : null}
      {rowPending ? (
        <span className="ml-auto shrink-0 text-tertiary" aria-hidden>
          …
        </span>
      ) : null}
      {tool.status === 'fail' && !rowPending ? (
        <Icon name="warning" size={11} className="ml-auto shrink-0 text-danger" />
      ) : null}
    </div>
  )
}

export const ToolGroup = memo(function ToolGroup({
  tools,
  groupTiming,
  labels = DEFAULT_LABELS,
  maxVisibleTools = 5,
  defaultOpen,
  expandedToolId,
  onToolToggle,
  onLoadFullContent
}: {
  tools: Extract<UiItem, { kind: 'tool' }>[]
  groupTiming?: Extract<UiItem, { kind: 'tool' }>['groupTiming']
  labels?: ToolGroupLabels
  maxVisibleTools?: number
  defaultOpen?: boolean
  expandedToolId?: string
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
}) {
  const uiTools = useMemo(() => tools.map((item) => item.tool), [tools])
  const resolvedGroupTiming = groupTiming ?? tools[0]?.groupTiming
  const props = useMemo(
    () => mapToolGroupProps(uiTools, { groupTiming: resolvedGroupTiming }),
    [uiTools, resolvedGroupTiming]
  )

  const { state, nestedTools, summary } = props
  const isPending = state === 'pending'
  const isInterrupted = state === 'interrupted'
  const hasNestedTools = nestedTools.length > 0

  const [expanded, setExpanded] = useState(defaultOpen ?? false)
  const [visibleCount, setVisibleCount] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(props.elapsedMs ?? 0)
  const wasPendingRef = useRef(isPending)
  const userToggledRef = useRef(false)
  const openTimerRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const streamKey = tools.map((t) => t.id).join(':')
  const maskThreshold = 4
  const streamHeight = Math.max(1, maxVisibleTools) * 28
  const visibleToolCount = isPending ? Math.max(visibleCount, 0) : nestedTools.length

  useEffect(() => {
    if (isPending && resolvedGroupTiming?.startedAt != null) {
      const startedAt = resolvedGroupTiming.startedAt
      setElapsedMs(Date.now() - startedAt)
      const interval = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAt)
      }, 1000)
      return () => window.clearInterval(interval)
    }
    if (props.elapsedMs != null) {
      setElapsedMs(props.elapsedMs)
    }
  }, [isPending, resolvedGroupTiming?.startedAt, props.elapsedMs])

  useEffect(() => {
    const wasPending = wasPendingRef.current
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    if (isPending && !wasPending) {
      if (!userToggledRef.current && defaultOpen !== false) {
        setExpanded(false)
        openTimerRef.current = window.setTimeout(() => {
          setExpanded(true)
        }, 60)
      }
    }
    if (!isPending && wasPending) {
      setExpanded(false)
      userToggledRef.current = false
    }
    wasPendingRef.current = isPending
    return () => {
      if (openTimerRef.current) {
        window.clearTimeout(openTimerRef.current)
        openTimerRef.current = null
      }
    }
  }, [defaultOpen, isPending])

  useEffect(() => {
    if (!isPending || nestedTools.length === 0) {
      setVisibleCount(nestedTools.length)
      return
    }
    let index = 1
    setVisibleCount(Math.min(index, nestedTools.length))
    const interval = window.setInterval(() => {
      index += 1
      setVisibleCount(Math.min(index, nestedTools.length))
      if (index >= nestedTools.length) window.clearInterval(interval)
    }, 450)
    return () => window.clearInterval(interval)
  }, [isPending, nestedTools.length, streamKey])

  useEffect(() => {
    if (!isPending || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [isPending, visibleCount])

  const elapsedTimeDisplay = isPending
    ? formatElapsedTime(elapsedMs)
    : props.elapsedDisplay

  const headerLabel = (() => {
    if (isInterrupted) return labels.interruptedLabel
    if (isPending) return labels.shimmerLabel
    return labels.completeLabel
  })()

  const detail = isPending && hasNestedTools ? summary : !isPending && hasNestedTools ? summary : ''

  const toggleExpand = (): void => {
    if (!hasNestedTools) return
    userToggledRef.current = true
    setExpanded((prev) => !prev)
  }

  const visibleTools = isPending
    ? nestedTools.slice(0, Math.max(visibleCount, 0))
    : nestedTools

  if (isInterrupted) {
    return (
      <div
        className="flex w-full max-w-[720px] flex-col gap-0.5 self-start font-sans text-xs tracking-[var(--vy-tracking)]"
        role="status"
      >
        <div className="flex items-center gap-1.5 rounded-sm bg-tool-row/60 px-2 py-1 text-muted">
          <p className="m-0 text-danger">{labels.interruptedLabel}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex w-full max-w-[720px] flex-col gap-0.5 self-start font-sans text-xs tracking-[var(--vy-tracking)]"
      role="status"
      aria-busy={isPending || undefined}
    >
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-1.5 rounded-sm bg-tool-row/60 px-2 py-1 text-left',
          hasNestedTools ? 'cursor-pointer' : 'cursor-default'
        )}
        onClick={toggleExpand}
        aria-expanded={hasNestedTools ? expanded : undefined}
        disabled={!hasNestedTools}
      >
        {isPending ? (
          <TextShimmer className="shrink-0 font-medium text-muted">{headerLabel}</TextShimmer>
        ) : (
          <span className="shrink-0 font-medium text-muted">{headerLabel}</span>
        )}
        {detail ? (
          <span className="min-w-0 truncate text-tertiary" title={detail}>
            {detail}
          </span>
        ) : null}
        {elapsedTimeDisplay ? (
          <span className="ml-auto shrink-0 tabular-nums text-tertiary">{elapsedTimeDisplay}</span>
        ) : null}
        {hasNestedTools ? (
          <Icon
            name="chevron"
            size={12}
            className={cn(
              'shrink-0 text-muted vy-transition',
              expanded ? 'rotate-0' : '-rotate-90',
              !elapsedTimeDisplay && 'ml-auto'
            )}
          />
        ) : null}
      </button>

      {expanded && hasNestedTools ? (
        <div className="relative pl-1">
          {isPending && visibleToolCount > maskThreshold ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-[var(--vy-bg)] to-transparent" />
          ) : null}
          <div
            ref={listRef}
            className={cn(
              'flex flex-col gap-0.5',
              isPending && visibleToolCount > maskThreshold && 'overflow-y-auto'
            )}
            style={
              isPending && visibleToolCount > maskThreshold
                ? { height: `${streamHeight}px` }
                : undefined
            }
          >
            {visibleTools.map((tool, idx) => {
              const toolItem = tools.find((item) => item.id === tool.id)
              const isExpanded = expandedToolId === tool.id
              return (
                <div key={tool.id} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToolToggle?.(tool.id, !isExpanded)
                    }}
                    aria-expanded={isExpanded}
                  >
                    <NestedToolRow
                      tool={tool}
                      isPending={isPending}
                      isLastVisible={isPending && idx === visibleTools.length - 1}
                    />
                  </button>
                  {isExpanded && toolItem ? (
                    <ToolRow
                      tool={toolItem.tool}
                      expanded
                      onLoadFullContent={onLoadFullContent}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
})
