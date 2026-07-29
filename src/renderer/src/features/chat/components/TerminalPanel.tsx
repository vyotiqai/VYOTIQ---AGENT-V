import { useMemo } from 'react'
import { cn } from '@renderer/lib/ui/cn'
import { Icon } from '@renderer/lib/icons'
import type { UiItem } from '@shared/transcript'
import { TerminalBody } from '../toolUi/bodies/TerminalBody'
import type { ToolItem } from '../utils/transcriptRows'

function isToolItem(item: UiItem): item is ToolItem {
  return item.kind === 'tool'
}

/**
 * Docked panel showing recent terminal tool output from the chat transcript.
 */
export function TerminalPanel({
  items,
  className,
  onClose
}: {
  items: UiItem[]
  className?: string
  onClose?: () => void
}) {
  const terminals = useMemo(() => {
    const out: ToolItem[] = []
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]
      if (!item || !isToolItem(item)) continue
      if (item.tool.name !== 'terminal') continue
      out.push(item)
      if (out.length >= 8) break
    }
    return out
  }, [items])

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-[min(42vw,480px)] shrink-0 flex-col overflow-hidden border-l border-border/50 bg-bg',
        className
      )}
      data-terminal-panel
      aria-label="Terminal panel"
    >
      <PanelHeader title="Terminal" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-auto">
        {terminals.length === 0 ? (
          <EmptyPanel
            icon="terminal"
            title="No terminal output yet"
            body="When the agent runs terminal commands, their output appears here."
          />
        ) : (
          <ul className="m-0 list-none space-y-2 p-2">
            {terminals.map((item) => (
              <li
                key={item.id}
                className="overflow-hidden rounded-md border border-border/50 bg-surface"
              >
                <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px]">
                  <Icon name="terminal" size={12} className="text-muted" />
                  <span className="min-w-0 flex-1 truncate font-mono text-fg" title={item.tool.summary}>
                    {item.tool.summary || item.tool.name}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 tabular-nums',
                      item.tool.status === 'fail'
                        ? 'text-danger'
                        : item.tool.status === 'running'
                          ? 'text-muted'
                          : 'text-success'
                    )}
                  >
                    {item.tool.status}
                  </span>
                </div>
                <TerminalBody tool={item.tool} expanded loading={false} loadFailed={false} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

export function PanelHeader({
  title,
  onClose
}: {
  title: string
  onClose?: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">{title}</span>
      {onClose ? (
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-fg"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()} panel`}
        >
          Close
        </button>
      ) : null}
    </div>
  )
}

export function EmptyPanel({
  icon,
  title,
  body
}: {
  icon: 'terminal' | 'file' | 'branch'
  title: string
  body: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Icon name={icon} size={28} className="mb-3 text-muted/50" />
      <p className="text-[12px] font-medium text-fg/80">{title}</p>
      <p className="mt-1 max-w-[16rem] text-[11px] leading-relaxed text-muted">{body}</p>
    </div>
  )
}
