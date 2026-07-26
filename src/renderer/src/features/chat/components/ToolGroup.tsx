import { memo, useEffect, useMemo, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { ACTIVITY_ROW, DISCLOSURE_ROW } from '@renderer/lib/utils/layout'
import { formatElapsed } from '@shared/utils/timeFormat'
import type { ToolItem } from '../utils/transcriptRows'
import { mapToolGroupProps, type ToolGroupNestedTool } from '../utils/toolGroupAdapter'
import { TextShimmer } from './TextShimmer'
import { ToolRowOutput } from './ToolRow'

/** Earliest start to latest end across every batch in the group. */
function spanGroupTiming(tools: ToolItem[]): ToolItem['groupTiming'] {
  let startedAt: number | undefined
  let endedAt: number | undefined
  let open = false

  for (const item of tools) {
    const timing = item.groupTiming
    if (timing?.startedAt != null) {
      startedAt = startedAt == null ? timing.startedAt : Math.min(startedAt, timing.startedAt)
      if (timing.endedAt == null) open = true
      else endedAt = endedAt == null ? timing.endedAt : Math.max(endedAt, timing.endedAt)
    }
  }

  if (startedAt == null) return undefined
  return open || endedAt == null ? { startedAt } : { startedAt, endedAt }
}

function NestedActivityLine({
  title,
  subtitle,
  status,
  expanded,
  onToggle
}: {
  title: string
  subtitle: string
  status: 'running' | 'done' | 'fail'
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={cn(DISCLOSURE_ROW, 'w-full text-left')}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className={cn('shrink-0 font-medium', status === 'fail' ? 'text-danger' : 'text-fg')}>
        {title}
      </span>
      {subtitle ? (
        <span className="min-w-0 truncate text-tertiary" title={subtitle}>
          {subtitle}
        </span>
      ) : null}
      {status === 'fail' ? (
        <Icon name="warning" size={11} className="ml-auto shrink-0 text-danger" />
      ) : null}
    </button>
  )
}

export const ToolGroup = memo(function ToolGroup({
  tools,
  groupTiming,
  expandedToolIds,
  groupExpanded,
  onGroupToggle,
  onToolToggle,
  onLoadFullContent
}: {
  tools: ToolItem[]
  groupTiming?: ToolItem['groupTiming']
  /** Every open call in this group, not just the first one the reader opened. */
  expandedToolIds?: ReadonlySet<string>
  /** Reader's disclosure choice; `undefined` follows the running/done default. */
  groupExpanded?: boolean
  onGroupToggle?: (expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
}) {
  const uiTools = useMemo(() => tools.map((item) => item.tool), [tools])
  // A group can span several tool batches, and only each batch's first item
  // carries timing — span the whole stretch instead of reading just the first.
  const resolvedGroupTiming = useMemo(
    () => groupTiming ?? spanGroupTiming(tools),
    [groupTiming, tools]
  )
  const props = useMemo(
    () => mapToolGroupProps(uiTools, { groupTiming: resolvedGroupTiming }),
    [uiTools, resolvedGroupTiming]
  )

  const { state, nestedTools, summary } = props
  const isPending = state === 'pending'
  const isInterrupted = state === 'interrupted'

  const nestedById = useMemo(() => {
    const map = new Map<string, ToolGroupNestedTool>()
    for (const tool of nestedTools) map.set(tool.id, tool)
    return map
  }, [nestedTools])

  // A running group shows its calls as they land, then folds back into a single
  // summary line once the work is done — unless the reader has said otherwise.
  // That choice belongs in transcript state so a remount (tab/workspace switch)
  // does not silently reset it; the local fallback only covers a host that does
  // not persist disclosure.
  const [localOverride, setLocalOverride] = useState<boolean | null>(null)
  const expanded = groupExpanded ?? localOverride ?? isPending
  const toggle = (): void => {
    const next = !expanded
    if (onGroupToggle) onGroupToggle(next)
    else setLocalOverride(next)
  }
  const [elapsedMs, setElapsedMs] = useState(props.elapsedMs ?? 0)

  useEffect(() => {
    if (isPending && resolvedGroupTiming?.startedAt != null) {
      const startedAt = resolvedGroupTiming.startedAt
      setElapsedMs(Date.now() - startedAt)
      const interval = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAt)
      }, 1000)
      return () => window.clearInterval(interval)
    }
    if (props.elapsedMs != null) setElapsedMs(props.elapsedMs)
    return undefined
  }, [isPending, resolvedGroupTiming?.startedAt, props.elapsedMs])

  const elapsedDisplay =
    isPending && elapsedMs >= 1000 ? formatElapsed(elapsedMs) : props.elapsedDisplay

  const headerLabel = isPending ? props.runningLabel : props.doneLabel

  return (
    <div className={ACTIVITY_ROW} role="group" aria-busy={isPending || undefined}>
      <button
        type="button"
        className={cn(DISCLOSURE_ROW, 'w-full text-left')}
        onClick={toggle}
        aria-expanded={expanded}
      >
        {isPending ? (
          <TextShimmer className="shrink-0 font-medium text-fg">{headerLabel}</TextShimmer>
        ) : (
          <span className={cn('shrink-0 font-medium', isInterrupted ? 'text-danger' : 'text-fg')}>
            {headerLabel}
          </span>
        )}
        {summary ? (
          <span className="min-w-0 truncate text-tertiary" title={summary}>
            {summary}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {isInterrupted ? <span className="text-danger">interrupted</span> : null}
          {elapsedDisplay ? (
            <span className="tabular-nums text-tertiary">{elapsedDisplay}</span>
          ) : null}
          <Icon
            name="chevronRight"
            size={12}
            className={cn('text-tertiary vy-transition', expanded && 'rotate-90')}
          />
        </span>
      </button>

      {expanded ? (
        <div className="flex flex-col">
          {tools.map((item) => {
            const nested = nestedById.get(item.id)
            if (!nested) return null
            const isToolExpanded = expandedToolIds?.has(item.id) ?? false
            return (
              <div key={item.id} className="flex min-w-0 flex-col">
                <NestedActivityLine
                  title={nested.title}
                  subtitle={nested.subtitle}
                  status={nested.status}
                  expanded={isToolExpanded}
                  onToggle={() => onToolToggle?.(item.id, !isToolExpanded)}
                />
                {isToolExpanded ? (
                  <ToolRowOutput tool={item.tool} onLoadFullContent={onLoadFullContent} />
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
})
