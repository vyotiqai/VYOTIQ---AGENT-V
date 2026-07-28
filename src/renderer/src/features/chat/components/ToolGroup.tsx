import { memo, useEffect, useMemo, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { ACTIVITY_ROW, DISCLOSURE_ROW } from '@renderer/lib/utils/layout'
import { formatElapsed } from '@shared/utils/timeFormat'
import type { ToolItem } from '../utils/transcriptRows'
import { mapToolGroupProps, type ToolGroupNestedTool } from '../utils/toolGroupAdapter'
import { TextShimmer } from './TextShimmer'
import { ToolRowOutput } from './ToolRow'
import { CompactRow, toolHasBody } from '../toolUi'

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

function NestedToolRow({
  item,
  nested,
  isToolExpanded,
  onToolToggle,
  onLoadFullContent,
  mcpServerNames
}: {
  item: ToolItem
  nested: ToolGroupNestedTool
  isToolExpanded: boolean
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
  mcpServerNames?: ReadonlyMap<string, string>
}) {
  const hasBody = toolHasBody(item.tool, {
    subagent: item.subagent,
    subagentContextUsage: item.subagentContextUsage
  })
  return (
    <div className="flex min-w-0 flex-col">
      <CompactRow
        title={nested.title}
        subtitle={nested.subtitle}
        status={nested.status}
        expanded={isToolExpanded}
        hasBody={hasBody}
        onToggle={() => onToolToggle?.(item.id, !isToolExpanded)}
      />
      {hasBody && isToolExpanded ? (
        <ToolRowOutput
          tool={item.tool}
          subagent={item.subagent}
          subagentContextUsage={item.subagentContextUsage}
          onLoadFullContent={onLoadFullContent}
          mcpServerNames={mcpServerNames}
          inGroup
        />
      ) : null}
    </div>
  )
}

export const ToolGroup = memo(function ToolGroup({
  tools,
  groupTiming,
  expandedToolIds,
  groupExpanded,
  onGroupToggle,
  onToolToggle,
  onLoadFullContent,
  mcpServerNames
}: {
  tools: ToolItem[]
  groupTiming?: ToolItem['groupTiming']
  expandedToolIds?: ReadonlySet<string>
  groupExpanded?: boolean
  onGroupToggle?: (expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
  mcpServerNames?: ReadonlyMap<string, string>
}) {
  const uiTools = useMemo(() => tools.map((item) => item.tool), [tools])
  const resolvedGroupTiming = useMemo(
    () => groupTiming ?? spanGroupTiming(tools),
    [groupTiming, tools]
  )
  const props = useMemo(
    () => mapToolGroupProps(uiTools, { groupTiming: resolvedGroupTiming }),
    [uiTools, resolvedGroupTiming]
  )

  const { state, nestedTools, summary, singleTool } = props
  const isPending = state === 'pending'
  const isInterrupted = state === 'interrupted'

  const nestedById = useMemo(() => {
    const map = new Map<string, ToolGroupNestedTool>()
    for (const tool of nestedTools) map.set(tool.id, tool)
    return map
  }, [nestedTools])

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

  if (singleTool && tools[0]) {
    const item = tools[0]
    const nested = nestedById.get(item.id)
    if (!nested) return null
    const hasBody = toolHasBody(item.tool, {
      subagent: item.subagent,
      subagentContextUsage: item.subagentContextUsage
    })
    const defaultExpanded = isPending || hasBody
    const isToolExpanded =
      item.toolExpanded ?? (groupExpanded ?? localOverride ?? defaultExpanded)
    const toggleSingle = (): void => {
      if (!hasBody) return
      const next = !isToolExpanded
      // Prefer per-tool expand so controller toolExpanded survives live updates.
      if (onToolToggle) onToolToggle(item.id, next)
      else if (onGroupToggle) onGroupToggle(next)
      else setLocalOverride(next)
    }
    return (
      <div className={ACTIVITY_ROW} role="group" aria-busy={isPending || undefined}>
        {isInterrupted ? (
          <div className="flex items-baseline gap-1.5 px-0 py-0.5 text-xs text-danger">
            <span>interrupted</span>
            {summary ? <span className="text-tertiary">{summary}</span> : null}
          </div>
        ) : null}
        <CompactRow
          title={nested.title}
          subtitle={nested.subtitle}
          status={nested.status}
          expanded={isToolExpanded}
          hasBody={hasBody}
          onToggle={toggleSingle}
        />
        {hasBody && isToolExpanded ? (
          <ToolRowOutput
            tool={item.tool}
            subagent={item.subagent}
            subagentContextUsage={item.subagentContextUsage}
            onLoadFullContent={onLoadFullContent}
            mcpServerNames={mcpServerNames}
          />
        ) : null}
      </div>
    )
  }

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
            size={14}
            className={cn('text-tertiary vy-transition', expanded && 'rotate-90')}
          />
        </span>
      </button>

      {expanded ? (
        <div className="flex flex-col gap-0.5 pl-2">
          {tools.map((item) => {
            const nested = nestedById.get(item.id)
            if (!nested) return null
            const isToolExpanded = expandedToolIds?.has(item.id) ?? false
            return (
              <NestedToolRow
                key={item.id}
                item={item}
                nested={nested}
                isToolExpanded={isToolExpanded}
                onToolToggle={onToolToggle}
                onLoadFullContent={onLoadFullContent}
                mcpServerNames={mcpServerNames}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
})
