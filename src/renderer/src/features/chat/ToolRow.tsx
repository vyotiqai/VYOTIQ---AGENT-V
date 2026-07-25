import { useState } from 'react'
import { Icon, type IconName } from '../../shared/icons'
import { IconButton, cn } from '../../shared/ui'
import type { UiToolRow } from '@shared/transcript'
import { TOOL_LABELS } from '@shared/toolSummary'

const TOOL_ICONS: Record<string, IconName> = {
  read: 'file',
  edit: 'edit',
  search: 'search',
  terminal: 'terminal',
  memory_list: 'memory',
  memory_read: 'memory',
  memory_write: 'memory'
}

const DETAIL_MAX = 4000

function truncate(text: string, max = DETAIL_MAX): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…`
}

export function ToolRow({ tool }: { tool: UiToolRow }) {
  const [open, setOpen] = useState(false)
  const icon = TOOL_ICONS[tool.name] ?? 'file'
  const labels = TOOL_LABELS[tool.name] ?? { running: tool.name, done: tool.name }
  const verb = tool.status === 'running' ? labels.running : labels.done
  const target = tool.summary || tool.argsPreview || tool.name
  const label = `${verb} ${target}`
  const hasDetails = Boolean(tool.content || tool.argsPreview)

  return (
    <div
      className="animate-fade-in flex max-w-[720px] flex-col gap-0.5 self-start rounded-sm bg-tool-row px-2 py-1 font-sans text-xs tracking-[var(--vy-tracking)] text-muted"
      role="status"
      aria-busy={tool.status === 'running' || undefined}
    >
      <div className="flex items-center gap-1.5">
        <Icon name={icon} size={12} className="shrink-0 text-muted" />
        <p
          className={cn(
            'm-0 min-w-0 flex-1 truncate [overflow-wrap:anywhere]',
            tool.status === 'fail' && 'text-danger'
          )}
        >
          <span className="text-muted">{label}</span>
          {tool.status === 'running' ? (
            <span className="ml-1 text-muted" aria-hidden>
              …
            </span>
          ) : null}
          {tool.status === 'fail' ? (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-danger">
              <Icon name="warning" size={11} />
              failed
            </span>
          ) : null}
        </p>
        {hasDetails && tool.status !== 'running' ? (
          <IconButton
            icon="chevron"
            label={open ? 'Hide tool details' : 'Show tool details'}
            size="xs"
            className={cn('text-muted', open ? 'rotate-0' : '-rotate-90')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          />
        ) : null}
      </div>
      {open && hasDetails ? (
        <pre className="m-0 max-h-48 overflow-auto rounded-sm bg-surface px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg/80 [overflow-wrap:anywhere]">
          {tool.argsPreview ? `args: ${truncate(tool.argsPreview)}\n\n` : ''}
          {tool.content ? truncate(tool.content) : ''}
        </pre>
      ) : null}
    </div>
  )
}
