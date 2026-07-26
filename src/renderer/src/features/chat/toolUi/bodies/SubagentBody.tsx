import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { TOOL_BODY_INNER } from '@renderer/lib/utils/layout'
import { MarkdownContent } from '@renderer/lib/ui'
import type { ToolBodyProps } from '../types'
import { TruncatedBanner } from '../primitives'

const STEP_ICON: Record<string, 'search' | 'edit' | 'check'> = {
  tool: 'edit',
  thinking: 'search',
  done: 'check',
  text: 'search'
}

export function SubagentBody({ tool, subagent, loading, loadFailed }: ToolBodyProps) {
  const steps = subagent ?? []
  const report = (tool.content ?? '').trim()

  return (
    <div className="flex flex-col gap-1">
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      {steps.length > 0 ? (
        <ul className={cn(TOOL_BODY_INNER, 'm-0 list-none space-y-1 p-0')}>
          {steps.map((entry, index) => (
            <li key={index} className="flex min-w-0 items-start gap-2 text-[11px]">
              <Icon
                name={STEP_ICON[entry.kind] ?? 'search'}
                size={10}
                className="mt-0.5 shrink-0 text-tertiary"
              />
              <span className="min-w-0 truncate text-tertiary" title={entry.text}>
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
