import { useMemo } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { TOOL_BODY_INNER } from '@renderer/lib/utils/layout'
import { formatTokens } from '@renderer/lib/utils/formatTokens'
import { MarkdownContent } from '@renderer/lib/ui'
import { useRunSession } from '../../RunSessionContext'
import type { ToolBodyProps } from '../types'
import type { SubagentContextUsageState } from '@shared/utils/contextUsage'
import { CopyButton, TruncatedBanner } from '../primitives'

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

function SubagentContextBar({ usage }: { usage: SubagentContextUsageState }) {
  const denominator = usage.contentWindow > 0 ? usage.contentWindow : usage.window
  const ratio = denominator > 0 ? Math.min(1, usage.used / denominator) : 0
  const pct = Math.round(ratio * 100)
  const barColor =
    ratio >= 0.9 ? 'bg-danger' : ratio >= 0.7 ? 'bg-warning' : 'bg-success'

  return (
    <div
      className={cn(TOOL_BODY_INNER, 'flex flex-col gap-1 border-b border-border/50 pb-2')}
      title={`Sub-agent context: ${formatTokens(usage.used)} / ${formatTokens(denominator)} (${usage.model})`}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] text-tertiary">
        <span>Sub-agent context · step {usage.step}</span>
        <span className="tabular-nums">
          {pct}% · {formatTokens(usage.used)}/{formatTokens(denominator)}
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

export function SubagentBody({
  tool,
  subagent,
  subagentContextUsage,
  loading,
  loadFailed
}: ToolBodyProps) {
  const steps = subagent ?? []
  const { reportPath, body } = useMemo(
    () => parsePersistedReport(tool.content ?? ''),
    [tool.content]
  )

  return (
    <div className="flex flex-col gap-1">
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      {subagentContextUsage ? <SubagentContextBar usage={subagentContextUsage} /> : null}
      {reportPath ? <ReportPathRow path={reportPath} /> : null}
      {steps.length > 0 ? (
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
