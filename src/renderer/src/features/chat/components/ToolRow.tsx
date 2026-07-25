import { useEffect, useState } from 'react'
import { Icon, type IconName } from '@renderer/lib/icons'
import { IconButton, cn } from '@renderer/lib/ui'
import type { UiToolRow } from '@shared/transcript'
import { formatToolRowLabel } from '@shared/toolSummary'
import { TOOL_RESULT_IPC_PREVIEW_CHARS } from '@shared/utils/toolResultIpc'

const TOOL_ICONS: Record<string, IconName> = {
  read: 'file',
  edit: 'edit',
  search: 'search',
  terminal: 'terminal',
  memory_list: 'memory',
  memory_read: 'memory',
  memory_write: 'memory'
}

const ARGS_PREVIEW_MAX = TOOL_RESULT_IPC_PREVIEW_CHARS

function truncateArgs(text: string, max = ARGS_PREVIEW_MAX): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…`
}

export function ToolRow({
  tool,
  expanded,
  onToggle,
  onLoadFullContent
}: {
  tool: UiToolRow
  expanded?: boolean
  onToggle?: (next: boolean) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
}) {
  const [localOpen, setLocalOpen] = useState(false)
  const isOpen = expanded ?? localOpen
  const [loadingFull, setLoadingFull] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const icon = TOOL_ICONS[tool.name] ?? 'file'
  const label = formatToolRowLabel(tool.name, tool.status, tool.summary, tool.argsPreview)
  const hasDetails = Boolean(tool.content || tool.argsPreview)

  const toggle = (): void => {
    const next = !isOpen
    if (onToggle) onToggle(next)
    else setLocalOpen(next)
  }

  useEffect(() => {
    if (!isOpen || !tool.contentTruncated || !onLoadFullContent) return
    let cancelled = false
    setLoadingFull(true)
    setLoadError(false)
    void onLoadFullContent(tool.id)
      .then((text) => {
        if (cancelled) return
        if (text == null) setLoadError(true)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoadingFull(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, tool.contentTruncated, tool.id, onLoadFullContent])

  useEffect(() => {
    if (!tool.contentTruncated) {
      setLoadError(false)
      setLoadingFull(false)
    }
  }, [tool.contentTruncated, tool.id])

  return (
    <div
      className="flex w-full max-w-[720px] flex-col gap-0.5 self-start font-sans text-xs tracking-[var(--vy-tracking)] text-muted"
      role="status"
      aria-busy={tool.status === 'running' || loadingFull || undefined}
    >
      <div className="flex items-center gap-1.5 rounded-sm bg-tool-row/60 px-2 py-1">
        <Icon name={icon} size={12} className="shrink-0 text-muted" />
        <p
          className={cn(
            'm-0 min-w-0 flex-1 [overflow-wrap:anywhere]',
            tool.status === 'fail' && 'text-danger'
          )}
          title={label}
        >
          <span className={tool.status === 'fail' ? 'text-danger' : 'text-muted'}>{label}</span>
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
        {hasDetails ? (
          <IconButton
            icon="chevron"
            label={isOpen ? 'Hide tool details' : 'Show tool details'}
            size="xs"
            className={cn('text-muted', isOpen ? 'rotate-0' : '-rotate-90')}
            aria-expanded={isOpen}
            onClick={toggle}
          />
        ) : null}
      </div>
      {isOpen && hasDetails ? (
        <div className="flex flex-col gap-1">
          {tool.contentTruncated ? (
            <p className="m-0 px-2 text-[10px] text-muted">
              {loadingFull
                ? 'Loading full output…'
                : loadError
                  ? 'Could not load full output.'
                  : 'Showing preview — full output loads on expand.'}
            </p>
          ) : null}
          <pre className="m-0 max-h-48 overflow-auto rounded-sm bg-surface px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg/80 [overflow-wrap:anywhere]">
            {tool.argsPreview ? `args: ${truncateArgs(tool.argsPreview)}\n\n` : ''}
            {tool.content ?? ''}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
