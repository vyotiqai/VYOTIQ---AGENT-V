import { useMemo } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { TOOL_BODY_INNER } from '@renderer/lib/utils/layout'
import { formatTokens } from '@renderer/lib/utils/formatTokens'
import { MarkdownContent } from '@renderer/lib/ui'
import { useRunSession } from '../../RunSessionContext'
import type { ToolBodyProps } from '../types'
import type {
  SubagentContextUsageState
} from '@shared/utils/contextUsage'
import type {
  UiNestedAgentLeaf,
  UiNestedAgentState,
  UiSubagentContextUsage,
  UiToolApproval
} from '@shared/transcript'
import { CopyButton, TruncatedBanner } from '../primitives'
import { ToolApprovalCard } from '../../components/ToolApprovalCard'

const STEP_ICON: Record<string, 'edit' | 'sparkles' | 'check' | 'doc'> = {
  tool: 'edit',
  thinking: 'sparkles',
  done: 'check',
  text: 'doc'
}

const PERSISTED_REPORT_RE = /^Persisted report:\s+(.+?)\s+\(re-read with/

function parsePersistedReport(content: string): { reportPath: string | null; body: string } {
  const trimmed = content.trim()
  if (!trimmed) return { reportPath: null, body: '' }
  const firstLine = trimmed.split('\n')[0] ?? ''
  const match = firstLine.match(PERSISTED_REPORT_RE)
  if (!match?.[1]) return { reportPath: null, body: trimmed }
  const reportPath = match[1].trim()
  const body = trimmed.replace(/^Persisted report:[^\n]*\n\n?/, '').trim()
  return { reportPath, body }
}

function SubagentContextBar({
  usage
}: {
  usage: SubagentContextUsageState | UiSubagentContextUsage
}) {
  const used = usage.used
  const windowSize = usage.contentWindow > 0 ? usage.contentWindow : usage.window
  const ratio = windowSize > 0 ? Math.min(1, used / windowSize) : 0
  const pct = Math.round(ratio * 100)
  const barColor =
    ratio >= 0.9 ? 'bg-danger' : ratio >= 0.7 ? 'bg-warning' : 'bg-success'
  const model = usage.model
  const step = usage.step

  return (
    <div
      className={cn(TOOL_BODY_INNER, 'flex flex-col gap-1 border-b border-border/50 pb-2')}
      title={`Nested agent context: ${formatTokens(used)} / ${formatTokens(windowSize)} (${model})`}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] text-tertiary">
        <span>Nested agent context · step {step}</span>
        <span className="tabular-nums">
          {pct}% · {formatTokens(used)}/{formatTokens(windowSize)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2" role="presentation">
        <div
          className={cn('h-full rounded-full transition-all duration-300', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function ReportPathRow({ path }: { path: string }) {
  const { workspacePath } = useRunSession()

  const openReport = (): void => {
    if (!workspacePath) return
    void window.vyotiq.slashCommandsOpenFile({ workspacePath, path })
  }

  return (
    <div className={cn(TOOL_BODY_INNER, 'flex min-w-0 items-center gap-2 border-b border-border/50 pb-2')}>
      <span className="shrink-0 text-[10px] text-tertiary">Report</span>
      {workspacePath ? (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-fg/80 underline-offset-2 hover:underline"
          title={path}
          onClick={openReport}
        >
          {path}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg/80" title={path}>
          {path}
        </span>
      )}
      <CopyButton text={path} className="shrink-0" />
    </div>
  )
}

function NestedApproval({
  approval,
  onRespond
}: {
  approval: UiToolApproval
  onRespond?: (requestId: string, decision: 'once' | 'session' | 'always' | 'deny') => void
}) {
  if (!onRespond) {
    return (
      <div className="rounded border border-border/60 bg-surface-2/40 px-2 py-1.5 text-[11px] text-tertiary">
        Approval pending: {approval.toolName} — {approval.summary}
      </div>
    )
  }
  return <ToolApprovalCard approval={approval} onDecide={onRespond} />
}

function NestedLeaf({
  leaf,
  onRespondApproval
}: {
  leaf: UiNestedAgentLeaf
  onRespondApproval?: (requestId: string, decision: 'once' | 'session' | 'always' | 'deny') => void
}) {
  if (leaf.kind === 'thinking') {
    return (
      <div className="flex gap-2 text-[11px] text-tertiary">
        <Icon name="sparkles" size={14} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 italic opacity-80">
          <MarkdownContent content={leaf.text} streaming={leaf.streaming} />
        </div>
      </div>
    )
  }
  if (leaf.kind === 'text') {
    return (
      <div className="text-[11px] text-fg/85">
        <MarkdownContent content={leaf.text} streaming={leaf.streaming} />
      </div>
    )
  }
  // tool
  const statusColor =
    leaf.tool.status === 'fail'
      ? 'text-danger'
      : leaf.tool.status === 'done'
        ? 'text-success'
        : 'text-tertiary'
  return (
    <div className="flex flex-col gap-1 rounded border border-border/40 bg-surface-2/30 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        <Icon name="edit" size={14} className={cn('shrink-0', statusColor)} />
        <span className="shrink-0 font-medium text-fg/90">{leaf.tool.name}</span>
        <span className="min-w-0 truncate text-tertiary">{leaf.tool.summary}</span>
      </div>
      {leaf.approval ? (
        <NestedApproval approval={leaf.approval} onRespond={onRespondApproval} />
      ) : null}
      {leaf.terminalOutput ? (
        <pre className="m-0 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-tertiary">
          {leaf.terminalOutput.slice(-4000)}
        </pre>
      ) : null}
      {leaf.tool.content && leaf.tool.status !== 'running' ? (
        <div className="max-h-40 overflow-auto text-[10px] text-tertiary">
          <MarkdownContent content={leaf.tool.content.slice(0, 4000)} />
        </div>
      ) : null}
    </div>
  )
}

function NestedAgentPanel({
  nested,
  onRespondApproval
}: {
  nested: UiNestedAgentState
  onRespondApproval?: (requestId: string, decision: 'once' | 'session' | 'always' | 'deny') => void
}) {
  return (
    <div className={cn(TOOL_BODY_INNER, 'flex flex-col gap-2 border-b border-border/50 pb-2')}>
      <div className="flex items-center gap-2 text-[10px] text-tertiary">
        <Icon name="bot" size={12} />
        <span className="font-mono">Nested agent {nested.subagentId}</span>
      </div>
      {nested.contextUsage ? <SubagentContextBar usage={nested.contextUsage} /> : null}
      <div className="flex flex-col gap-1.5">
        {nested.leaves.map((leaf) => (
          <NestedLeaf key={leaf.id} leaf={leaf} onRespondApproval={onRespondApproval} />
        ))}
      </div>
    </div>
  )
}

export function SubagentBody({
  tool,
  subagent,
  subagentContextUsage,
  nestedAgent,
  onRespondApproval,
  loading,
  loadFailed
}: ToolBodyProps) {
  const steps = subagent ?? []
  const { reportPath, body } = useMemo(
    () => parsePersistedReport(tool.content ?? ''),
    [tool.content]
  )

  const showLegacySteps = !nestedAgent?.leaves.length && steps.length > 0
  const contextUsage = nestedAgent?.contextUsage ?? subagentContextUsage

  return (
    <div className="flex flex-col gap-1">
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      {nestedAgent ? (
        <NestedAgentPanel nested={nestedAgent} onRespondApproval={onRespondApproval} />
      ) : contextUsage ? (
        <SubagentContextBar usage={contextUsage} />
      ) : null}
      {reportPath ? <ReportPathRow path={reportPath} /> : null}
      {showLegacySteps ? (
        <ul className={cn(TOOL_BODY_INNER, 'm-0 list-none space-y-1 p-0')}>
          {steps.map((entry, index) => (
            <li key={index} className="flex min-w-0 items-start gap-2 text-[11px]">
              <Icon
                name={STEP_ICON[entry.kind] ?? 'bot'}
                size={14}
                className="mt-0.5 shrink-0 text-tertiary"
              />
              <span className="min-w-0 whitespace-pre-wrap break-words text-tertiary">
                {entry.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {body ? (
        <div className={cn(TOOL_BODY_INNER, 'text-[11px] text-fg/80')}>
          <MarkdownContent content={body} />
        </div>
      ) : null}
    </div>
  )
}
