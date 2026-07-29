import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/ui/cn'
import type { AgentBrowserState } from '@shared/ipc'

const EMPTY: AgentBrowserState = {
  open: false,
  url: '',
  title: '',
  navigating: false,
  tabs: [],
  canGoBack: false,
  canGoForward: false
}

/**
 * Side chrome + layout slot for the main-process WebContentsView.
 * The live page is drawn by Electron over `data-agent-browser-viewport`.
 */
export function AgentBrowserPanel({ className }: { className?: string }) {
  const [state, setState] = useState<AgentBrowserState>(EMPTY)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.vyotiq.browserGetState?.().then((res) => {
      if (cancelled || !res.ok) return
      setState(res.data)
    })
    const unsub = window.vyotiq.onBrowserState?.((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!state.open || !el) {
      void window.vyotiq.browserSetBounds?.(null)
      return undefined
    }

    const report = (): void => {
      const r = el.getBoundingClientRect()
      void window.vyotiq.browserSetBounds?.({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      })
    }

    report()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null
    ro?.observe(el)
    window.addEventListener('resize', report)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', report)
      void window.vyotiq.browserSetBounds?.(null)
    }
  }, [state.open, state.tabs?.length, state.url])

  if (!state.open) return null

  const title = state.title?.trim() || 'Agent browser'
  const url = state.url?.trim() || ''
  const tabs = state.tabs ?? []

  return (
    <div
      className={cn(
        'flex h-full w-[min(48vw,560px)] shrink-0 flex-col border-l border-border bg-surface',
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
      <div className="flex min-w-0 items-start gap-2 border-b border-border px-2.5 py-1.5 text-[11px]">
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
          title="Focus page"
        >
          Focus
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
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 bg-surface-2/30"
        data-agent-browser-viewport
      />
    </div>
  )
}
