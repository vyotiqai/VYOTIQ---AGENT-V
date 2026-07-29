import { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/ui/cn'
import type { AgentBrowserState } from '@shared/ipc'

const EMPTY: AgentBrowserState = {
  open: false,
  url: '',
  title: '',
  snapshotDataUrl: null,
  navigating: false,
  tabs: [],
  canGoBack: false,
  canGoForward: false
}

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
  const tabs = state.tabs ?? []

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-surface shadow-sm',
        className
      )}
      data-agent-browser-panel
    >
      {tabs.length > 0 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'max-w-[9rem] shrink-0 truncate rounded-md px-1.5 py-0.5 text-[10px]',
                tab.active
                  ? 'bg-surface-2 font-medium text-fg'
                  : 'text-muted hover:bg-surface-2/60 hover:text-fg'
              )}
              title={`${tab.title || tab.id}\n${tab.url}`}
              onClick={() => {
                void window.vyotiq.browserSelectTab(tab.id)
              }}
            >
              {tab.title?.trim() || tab.id}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex min-w-0 items-start gap-2 px-2.5 py-1.5 text-[11px]">
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded-lg border border-border px-1.5 py-0.5 text-fg transition-colors hover:bg-surface-2 disabled:opacity-40"
            disabled={!state.canGoBack}
            onClick={() => {
              void window.vyotiq.browserBack()
            }}
            title="Back"
          >
            ←
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-1.5 py-0.5 text-fg transition-colors hover:bg-surface-2 disabled:opacity-40"
            disabled={!state.canGoForward}
            onClick={() => {
              void window.vyotiq.browserForward()
            }}
            title="Forward"
          >
            →
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-medium text-fg">Browser</span>
            <span className="min-w-0 flex-1 truncate text-fg" title={title}>
              {title}
            </span>
            {state.navigating ? (
              <span className="shrink-0 text-muted">Loading…</span>
            ) : null}
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
            className="max-h-56 w-full object-contain object-top"
          />
        </button>
      ) : null}
    </div>
  )
}
