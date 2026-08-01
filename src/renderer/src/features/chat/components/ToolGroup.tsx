import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { ACTIVITY_ROW, DISCLOSURE_ROW, TOOL_GROUP_LIST_VIEWPORT } from '@renderer/lib/utils/layout'
import { formatElapsed } from '@shared/utils/timeFormat'
import type { ToolApprovalDecision } from '@shared/ipc'
import type { ToolItem } from '../utils/transcriptRows'
import { mapToolGroupProps, type ToolGroupNestedTool } from '../utils/toolGroupAdapter'
import { TextShimmer } from './TextShimmer'
import { ToolRowOutput } from './ToolRow'
import {
  CompactRow,
  ExpandPanel,
  familyDefaultExpanded,
  isInterruptedToolContent,
  toolCategory,
  toolHasBody,
  toolLabel
} from '../toolUi'

const LIST_PIN_PX = 24

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
  staggerIndex,
  isToolExpanded,
  onToolToggle,
  onLoadFullContent,
  onApprovalDecision,
  mcpServerNames
}: {
  item: ToolItem
  nested: ToolGroupNestedTool
  staggerIndex: number
  isToolExpanded: boolean
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
  onApprovalDecision?: (requestId: string, decision: ToolApprovalDecision) => void
  mcpServerNames?: ReadonlyMap<string, string>
}) {
  const hasBody = toolHasBody(item.tool, {
    subagent: item.subagent,
    subagentContextUsage: item.subagentContextUsage,
    nestedAgent: item.nestedAgent
  })
  const rowInterrupted = isInterruptedToolContent(item.tool.content)
  return (
    <div
      className="tool-stagger-enter flex min-w-0 flex-col"
      style={{ '--stagger-index': staggerIndex } as CSSProperties}
    >
      <CompactRow
        title={nested.title}
        subtitle={nested.subtitle}
        status={nested.status}
        expanded={isToolExpanded}
        hasBody={hasBody}
        interrupted={rowInterrupted}
        onToggle={() => onToolToggle?.(item.id, !isToolExpanded)}
      />
      <ExpandPanel open={hasBody && isToolExpanded}>
        <div className="tool-body-enter">
          <ToolRowOutput
            tool={item.tool}
            subagent={item.subagent}
            subagentContextUsage={item.subagentContextUsage}
            nestedAgent={item.nestedAgent}
            onRespondApproval={onApprovalDecision}
            onLoadFullContent={onLoadFullContent}
            mcpServerNames={mcpServerNames}
            inGroup
            indent={false}
          />
        </div>
      </ExpandPanel>
    </div>
  )
}

export const ToolGroup = memo(function ToolGroup({
  tools,
  groupTiming,
  expandedToolIds,
  groupExpanded,
  /** True for the active turn while the chat run is live — keep this group open between batches. */
  live = false,
  onGroupToggle,
  onToolToggle,
  onLoadFullContent,
  onApprovalDecision,
  mcpServerNames
}: {
  tools: ToolItem[]
  groupTiming?: ToolItem['groupTiming']
  expandedToolIds?: ReadonlySet<string>
  groupExpanded?: boolean
  live?: boolean
  onGroupToggle?: (expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
  onApprovalDecision?: (requestId: string, decision: ToolApprovalDecision) => void
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
  // While tools are still running, keep the group open even if the user collapsed it.
  const expanded = isPending
    ? true
    : (groupExpanded ?? localOverride ?? live)
  const toggle = (): void => {
    if (isPending) return
    const next = !expanded
    if (onGroupToggle) onGroupToggle(next)
    else setLocalOverride(next)
  }
  const [elapsedMs, setElapsedMs] = useState(props.elapsedMs ?? 0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const listPinnedRef = useRef(true)
  const toolsScrollKey = useMemo(
    () =>
      tools
        .map(
          (t) =>
            `${t.id}:${t.tool.status}:${t.tool.content?.length ?? 0}:${t.tool.summary ?? ''}`
        )
        .join('|'),
    [tools]
  )

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

  const listLive = isPending || live

  useEffect(() => {
    if (listLive) listPinnedRef.current = true
  }, [listLive])

  useEffect(() => {
    if (!listLive || singleTool) return
    const el = listRef.current
    if (!el || !listPinnedRef.current) return
    el.scrollTop = el.scrollHeight
  }, [listLive, singleTool, toolsScrollKey])

  const onListScroll = (event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    listPinnedRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= LIST_PIN_PX
  }

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
        title: toolLabel(item.tool.name, item.tool.status, item.tool.content),
        subtitle: item.tool.summary?.trim() || '',
        status: item.tool.status
      }
    const hasBody = toolHasBody(item.tool, {
      subagent: item.subagent,
      subagentContextUsage: item.subagentContextUsage,
      nestedAgent: item.nestedAgent
    })
    const defaultExpanded =
      live || familyDefaultExpanded(item.tool.name, item.tool.status)
    // toolExpanded wins; otherwise keep running/live bodies open even when
    // groupExpanded is false. Idle tools still honor persisted groupExpanded.
    const isToolExpanded =
      item.toolExpanded ??
      localOverride ??
      (defaultExpanded || (groupExpanded ?? false))
    const toggleSingle = (): void => {
      if (!hasBody) return
      const next = !isToolExpanded
      // Prefer per-tool expand so controller toolExpanded survives live updates.
      if (onToolToggle) onToolToggle(item.id, next)
      else if (onGroupToggle) onGroupToggle(next)
      else setLocalOverride(next)
    }
    return (
      <div
        className={cn(ACTIVITY_ROW, 'tool-stagger-enter')}
        role="group"
        aria-busy={isPending || live || undefined}
        style={{ '--stagger-index': 0 } as CSSProperties}
      >
        <CompactRow
          title={nested.title}
          subtitle={nested.subtitle}
          status={nested.status}
          expanded={isToolExpanded}
          hasBody={hasBody}
          interrupted={isInterrupted}
          onToggle={toggleSingle}
        />
        <ExpandPanel open={hasBody && isToolExpanded}>
          <div className="tool-body-enter">
            <ToolRowOutput
              tool={item.tool}
              subagent={item.subagent}
              subagentContextUsage={item.subagentContextUsage}
              nestedAgent={item.nestedAgent}
              onRespondApproval={onApprovalDecision}
              onLoadFullContent={onLoadFullContent}
              mcpServerNames={mcpServerNames}
              inGroup
              indent={false}
            />
          </div>
        </ExpandPanel>
      </div>
    )
  }

  return (
    <div className={ACTIVITY_ROW} role="group" aria-busy={isPending || live || undefined}>
      <button
        type="button"
        className={cn(DISCLOSURE_ROW, 'w-full text-left')}
        onClick={toggle}
        aria-expanded={expanded}
      >
        {isPending ? (
          <TextShimmer className="shrink-0 font-medium text-fg">{headerLabel}</TextShimmer>
        ) : (
          <span
            className={cn(
              'shrink-0 font-medium tool-status-morph',
              isInterrupted ? 'text-danger' : 'text-fg'
            )}
          >
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

      <ExpandPanel open={expanded}>
        <div
          ref={listRef}
          className={cn('flex flex-col gap-0.5 pl-2', TOOL_GROUP_LIST_VIEWPORT)}
          data-testid="tool-group-list"
          onScroll={onListScroll}
        >
          {tools.map((item, index) => {
            const nested = nestedById.get(item.id)
            if (!nested) {
              return (
                <div
                  key={item.id}
                  className="tool-stagger-enter rounded-md px-2 py-1 text-[12px] text-muted"
                  style={{ '--stagger-index': index } as CSSProperties}
                  data-testid={`tool-group-fallback-${item.id}`}
                >
                  {item.tool.name}
                  {item.tool.status === 'running' ? '…' : ''}
                </div>
              )
            }
            const defaultExpanded =
              live || familyDefaultExpanded(item.tool.name, item.tool.status)
            // Per-item toolExpanded wins; expandedToolIds is an optional host override
            // for tests. Never treat Set membership as exclusive of defaults for siblings.
            const isToolExpanded =
              item.toolExpanded ??
              (expandedToolIds != null ? expandedToolIds.has(item.id) : defaultExpanded)
            return (
              <NestedToolRow
                key={item.id}
                item={item}
                nested={nested}
                staggerIndex={index}
                isToolExpanded={isToolExpanded}
                onToolToggle={onToolToggle}
                onLoadFullContent={onLoadFullContent}
                onApprovalDecision={onApprovalDecision}
                mcpServerNames={mcpServerNames}
              />
            )
          })}
        </div>
      </ExpandPanel>
    </div>
  )
})
