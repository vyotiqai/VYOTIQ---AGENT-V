import { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/ui/cn'
import type { AgentBrowserState } from '@shared/ipc'

const EMPTY: AgentBrowserState = { open: false, url: '', title: '', snapshotDataUrl: null }

export function AgentBrowserPanel({ className }: { className?: string }) {
  const [state, setState] = useState<AgentBrowserState>(EMPTY)

  useEffect(() => {
    let cancelled = false
    void window.vyotiq.browserGetState().then((res) => {
      if (cancelled || !res.ok) return
      setState(res.data)
    })
    const unsub = window.vyotiq.onBrowserState((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  if (!state.open && !state.snapshotDataUrl) return null

  const title = state.title?.trim() || 'Agent browser'
  const url = state.url?.trim() || ''

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-surface shadow-sm',
        className
      )}
      data-agent-browser-panel
    >
      <div className="flex min-w-0 items-start gap-2 px-2.5 py-1.5 text-[11px]">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-medium text-fg">Browser</span>
            <span className="min-w-0 flex-1 truncate text-fg" title={title}>
              {title}
            </span>
          </div>
          {url ? (
            <div className="mt-0.5 truncate text-muted" title={url}>
              {url}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-border px-1.5 py-0.5 text-fg transition-colors hover:bg-surface-2"
          onClick={() => {
            void window.vyotiq.browserFocus()
          }}
        >
          Show
        </button>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-border px-1.5 py-0.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          onClick={() => {
            void window.vyotiq.browserClose()
          }}
        >
          Close
        </button>
      </div>
      {state.snapshotDataUrl ? (
        <button
          type="button"
          className="block w-full border-t border-border bg-surface-2/40 p-0 text-left"
          onClick={() => {
            void window.vyotiq.browserFocus()
          }}
          title="Show live browser"
        >
          <img
            src={state.snapshotDataUrl}
            alt={title}
            className="max-h-40 w-full object-cover object-top"
          />
        </button>
      ) : null}
    </div>
  )
}
