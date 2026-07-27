import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { TOOL_BODY_INNER } from '@renderer/lib/utils/layout'
import { formatTokens } from '@renderer/lib/utils/formatTokens'
import { MarkdownContent } from '@renderer/lib/ui'
import type { ToolBodyProps } from '../types'
import type { SubagentContextUsageState } from '@shared/utils/contextUsage'

const STEP_ICON: Record<string, 'edit' | 'sparkles' | 'check' | 'doc'> = {
  tool: 'edit',
  thinking: 'sparkles',
  done: 'check',
  text: 'doc'
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

export function SubagentBody({
  tool,
  subagent,
  subagentContextUsage
}: ToolBodyProps) {
  const steps = subagent ?? []
  const report = (tool.content ?? '').trim()

  return (
    <div className="flex flex-col gap-1">
      {subagentContextUsage ? <SubagentContextBar usage={subagentContextUsage} /> : null}
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
      {report ? (
        <div className={cn(TOOL_BODY_INNER, 'text-[11px] text-fg/80')}>
          <MarkdownContent content={report} />
        </div>
      ) : null}
    </div>
  )
}
