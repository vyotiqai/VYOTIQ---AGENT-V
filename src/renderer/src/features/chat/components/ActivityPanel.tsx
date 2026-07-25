import { useEffect, useRef, useState } from 'react'
import type { ActivityRow } from '@shared/eventUtils'
import { formatDisplayTime } from '@shared/utils/timeFormat'
import { formatActivityEventLabel } from '@shared/toolSummary'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { CHAT_COLUMN } from '@renderer/lib/utils/layout'

export function ActivityPanel({
  rows,
  running
}: {
  rows: ActivityRow[]
  running?: boolean
}) {
  const [open, setOpen] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !running) return
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [rows.length, open, running])

  if (!rows.length) return null

  return (
    <div className={cn('mb-2 w-full', CHAT_COLUMN)} data-activity-panel>
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-left text-xs text-secondary vy-transition',
          'hover:bg-surface-2'
        )}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon
          name="chevronRight"
          size={12}
          className={cn('shrink-0 text-tertiary vy-transition', open && 'rotate-90')}
        />
        <span className="font-medium text-fg-muted">Activity</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-tertiary">
          {rows.length}
        </span>
        {running ? (
          <span className="ml-auto inline-block size-1.5 animate-pulse rounded-full bg-secondary" />
        ) : null}
      </button>
      {open ? (
        <div
          className="mt-1 max-h-36 overflow-y-auto rounded-md border border-border bg-surface-1 px-2 py-1.5"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {rows.map((row, index) => (
              <li
                key={`${row.at}-${row.event.type}-${index}`}
                className="flex items-baseline gap-2 text-[11px] leading-snug text-secondary"
              >
                <time className="shrink-0 tabular-nums text-tertiary" dateTime={row.at}>
                  {formatDisplayTime(row.at, { seconds: true })}
                </time>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {formatActivityEventLabel(row.event)}
                </span>
              </li>
            ))}
          </ul>
          <div ref={endRef} />
        </div>
      ) : null}
    </div>
  )
}
