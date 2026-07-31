import { memo, useEffect, useMemo, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { ACTIVITY_ROW, DISCLOSURE_ROW } from '@renderer/lib/utils/layout'
import { formatElapsed } from '@shared/utils/timeFormat'
import type { ToolItem } from '../utils/transcriptRows'
import { mapToolGroupProps, type ToolGroupNestedTool } from '../utils/toolGroupAdapter'
import { TextShimmer } from './TextShimmer'
import { ToolRowOutput } from './ToolRow'
import { CompactRow, toolCategory, toolHasBody, toolLabel } from '../toolUi'

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
      {!hasBody && nested.status === 'running' ? (
        <div className="border-t border-border/40 bg-surface px-3 py-1.5 text-[11px] text-tertiary">
          <TextShimmer>Working…</TextShimmer>
        </div>
      ) : null}
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
    const nested =
      nestedById.get(item.id) ??
      nestedById.get(item.tool.id) ??
      nestedTools[0] ?? {
        id: item.id,
        name: item.tool.name,
        category: toolCategory(item.tool.name),
        title: toolLabel(item.tool.name, item.tool.status),
        subtitle: item.tool.summary?.trim() || '',
        status: item.tool.status
      }
    const hasBody = toolHasBody(item.tool, {
      subagent: item.subagent,
      subagentContextUsage: item.subagentContextUsage
    })
    // Bodies auto-open only while that tool is actively running (or host says so).
    const defaultExpanded = item.tool.status === 'running'
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
        <CompactRow
          title={nested.title}
          subtitle={nested.subtitle}
          status={nested.status}
          expanded={isToolExpanded}
          hasBody={hasBody}
          interrupted={isInterrupted}
          onToggle={toggleSingle}
        />
        {!hasBody && nested.status === 'running' ? (
          <div className="border-t border-border/40 bg-surface px-3 py-1.5 text-[11px] text-tertiary">
            <TextShimmer>Working…</TextShimmer>
          </div>
        ) : null}
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
            className={cn('shrink-0 text-tertiary vy-transition', expanded && 'rotate-90')}
          />
        </span>
      </button>

      {expanded ? (
        <div className="flex flex-col gap-0.5 pl-2">
          {tools.map((item) => {
            const nested = nestedById.get(item.id)
            if (!nested) {
              return (
                <div
                  key={item.id}
                  className="rounded-md px-2 py-1 text-[12px] text-muted"
                  data-testid={`tool-group-fallback-${item.id}`}
                >
                  {item.tool.name}
                  {item.tool.status === 'running' ? '…' : ''}
                </div>
              )
            }
            const hasBody = toolHasBody(item.tool, {
              subagent: item.subagent,
              subagentContextUsage: item.subagentContextUsage
            })
            // Bodies auto-open only for the running tool; completed siblings stay collapsed.
            const defaultExpanded = item.tool.status === 'running'
            // When the host passes expandedToolIds, membership is authoritative.
            // MessageList omits the prop (undefined) until a tool has explicit
            // toolExpanded so defaultExpanded can still auto-open running bodies.
            const isToolExpanded = expandedToolIds
              ? expandedToolIds.has(item.id)
              : (item.toolExpanded ?? defaultExpanded)
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
