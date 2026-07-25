import { useEffect, useMemo, useState } from 'react'
import type { AgentEvent, PersistedEvent } from '@shared/ipc'
import { Icon } from '../../shared/icons'
import { IconButton, cn } from '../../shared/ui'
import { LG_BREAKPOINT } from '../../shared/utils/breakpoints'
import { useEscapeToClose } from '../../shared/hooks/useEscapeToClose'
import { useMediaQuery } from '../../shared/hooks/useMediaQuery'

function isAgentEvent(value: unknown): value is AgentEvent {
  return Boolean(value && typeof value === 'object' && 'type' in value)
}

function formatEventTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case 'tool_start':
      return `${event.name}: ${event.summary}`
    case 'tool_result':
      return `${event.name}: ${event.summary} (${event.ok ? 'ok' : 'fail'})`
    case 'status':
      return `Run ${event.status}`
    case 'error':
      return event.message
    default:
      return event.type
  }
}

function eventTone(event: AgentEvent): string {
  if (event.type === 'error') return 'text-danger'
  if (event.type === 'tool_result' && !event.ok) return 'text-danger'
  if (event.type === 'status' && (event.status === 'error' || event.status === 'cancelled')) {
    return 'text-danger'
  }
  if (event.type === 'status' && event.status === 'done') return 'text-muted'
  return 'text-fg'
}

type ActivityRow = { at: string; event: AgentEvent }

function normalizeEvents(rows: PersistedEvent[]): ActivityRow[] {
  const out: ActivityRow[] = []
  for (const row of rows) {
    if (!isAgentEvent(row.event)) continue
    if (
      row.event.type === 'text_delta' ||
      row.event.type === 'tool_call_delta' ||
      row.event.type === 'assistant_message'
    ) {
      continue
    }
    out.push({ at: row.at, event: row.event })
  }
  return out
}

export function ActivityPanel({
  open,
  runId,
  workspacePath,
  refreshKey,
  live,
  onClose
}: {
  open: boolean
  runId: string | null
  workspacePath: string | null
  /** Bumps when a run finishes so the log reloads. */
  refreshKey?: number
  /** Poll for new events while the run is active. */
  live?: boolean
  onClose: () => void
}) {
  const isDesktop = useMediaQuery(LG_BREAKPOINT, true)
  const [events, setEvents] = useState<PersistedEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscapeToClose(onClose, open, { capture: true })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!runId || !window.vyotiq?.loadRunEvents) {
        setEvents([])
        setError(runId ? 'Activity log is unavailable.' : null)
        return
      }
      setLoading(true)
      setError(null)
      const res = await window.vyotiq.loadRunEvents(workspacePath, runId)
      if (cancelled) return
      setLoading(false)
      if (res.ok) {
        setEvents(res.data)
        setError(null)
      } else {
        setEvents([])
        setError(res.error)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, runId, workspacePath, refreshKey])

  useEffect(() => {
    if (!open || !live || !runId) return
    const id = window.setInterval(() => {
      void (async () => {
        if (!window.vyotiq?.loadRunEvents) return
        const res = await window.vyotiq.loadRunEvents(workspacePath, runId)
        if (res.ok) setEvents(res.data)
      })()
    }, 2000)
    return () => window.clearInterval(id)
  }, [open, live, runId, workspacePath])

  const rows = useMemo(() => normalizeEvents(events), [events])

  if (!open) return null

  const content = (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-medium tracking-[var(--vy-tracking-tight)] text-fg-strong">
            Activity
          </h2>
          <p className="m-0 mt-0.5 truncate text-xs text-muted">
            {runId ? `Run ${runId.slice(0, 8)}` : 'Start or open a session'}
          </p>
        </div>
        <IconButton icon="close" label="Close activity panel" size="sm" onClick={onClose} />
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto px-3 py-2"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {!runId ? (
          <p className="m-0 text-sm text-muted">No active session. Send a message or pick a run.</p>
        ) : loading ? (
          <p className="m-0 text-sm text-muted">Loading events…</p>
        ) : error ? (
          <p className="m-0 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="m-0 text-sm text-muted">No activity events yet.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {rows.map((row, index) => (
              <li
                key={`${row.at}-${index}`}
                className="flex gap-2 rounded-md px-1.5 py-1 text-xs vy-transition hover:bg-surface"
              >
                <time
                  className="shrink-0 tabular-nums text-muted"
                  dateTime={row.at}
                  title={row.at}
                >
                  {formatEventTime(row.at)}
                </time>
                <span className={cn('min-w-0 [overflow-wrap:anywhere]', eventTone(row.event))}>
                  {eventLabel(row.event)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  )

  if (!isDesktop) {
    return (
      <div
        className="fixed inset-0 z-drawer flex flex-col justify-end lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Activity log"
      >
        <button
          type="button"
          className="absolute inset-0 bg-overlay animate-fade-in"
          aria-label="Close activity panel"
          onClick={onClose}
        />
        <div className="relative flex max-h-[min(72vh,520px)] flex-col rounded-t-xl border border-border bg-card shadow-menu animate-fade-in">
          {content}
        </div>
      </div>
    )
  }

  return (
    <aside
      className="hidden h-full w-[min(280px,32vw)] shrink-0 flex-col border-l border-border bg-card lg:flex"
      aria-label="Activity log"
    >
      {content}
    </aside>
  )
}

/** Toolbar toggle for opening the activity panel. */
export function ActivityToggle({
  open,
  disabled,
  onToggle
}: {
  open: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <IconButton
      icon="terminal"
      label={open ? 'Close activity log' : 'Open activity log'}
      size="sm"
      className={cn(open && 'bg-surface-2 text-fg')}
      disabled={disabled}
      aria-pressed={open}
      onClick={onToggle}
    />
  )
}
