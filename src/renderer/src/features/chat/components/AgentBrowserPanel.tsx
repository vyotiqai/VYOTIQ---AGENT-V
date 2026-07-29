import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 * Docked right-side panel hosting the main-process `WebContentsView`.
 * Styled to match Cursor's built-in browser chrome.
 */
export function AgentBrowserPanel({ className }: { className?: string }) {
  const [state, setState] = useState<AgentBrowserState>(EMPTY)
  const [urlInput, setUrlInput] = useState('')
  const [urlFocused, setUrlFocused] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

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

  // Sync urlInput when not focused
  useEffect(() => {
    if (!urlFocused) {
      setUrlInput(state.url?.trim() || '')
    }
  }, [state.url, urlFocused])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return undefined

    let cancelled = false
    const report = (): void => {
      if (cancelled) return
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) return
      void window.vyotiq.browserSetBounds?.({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      })
    }

    report()
    const raf = requestAnimationFrame(report)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null
    ro?.observe(el)
    window.addEventListener('resize', report)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', report)
      void window.vyotiq.browserSetBounds?.(null)
    }
  }, [])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const tabs = state.tabs ?? []
  const hasPage = Boolean(state.open) && tabs.length > 0

  const handleNavigate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      let target = urlInput.trim()
      if (!target) return
      if (!/^https?:\/\//i.test(target)) {
        if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(target)) {
          target = `https://${target}`
        } else {
          target = `https://www.google.com/search?q=${encodeURIComponent(target)}`
        }
      }
      void window.vyotiq.browserNavigate?.(target)
      urlInputRef.current?.blur()
    },
    [urlInput]
  )

  const handleMenuAction = useCallback(
    (action: string) => {
      setMenuOpen(false)
      switch (action) {
        case 'reload':
          void window.vyotiq.browserReload?.()
          break
        case 'copy-url':
          if (state.url) void navigator.clipboard.writeText(state.url)
          break
        case 'close':
          void window.vyotiq.browserClose?.()
          break
        default:
          break
      }
    },
    [state.url]
  )

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-[min(42vw,480px)] shrink-0 flex-col overflow-hidden border-l border-border/50 bg-bg',
        className
      )}
      data-agent-browser-panel
      aria-label="Browser panel"
    >
      {/* Tab bar */}
      {tabs.length > 1 ? (
        <div className="flex gap-0.5 overflow-x-auto border-b border-border/30 bg-surface px-1.5 pt-1.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'flex max-w-[10rem] shrink-0 items-center gap-1 truncate rounded-t-md px-2 py-1 text-[11px]',
                tab.active
                  ? 'bg-bg font-medium text-fg'
                  : 'text-muted hover:bg-bg/50 hover:text-fg'
              )}
              title={`${tab.title || tab.id}\n${tab.url}`}
              onClick={() => {
                void window.vyotiq.browserSelectTab?.(tab.id)
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-60">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="truncate">{tab.title?.trim() || tab.id}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Navigation bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        {/* Back */}
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-fg/70 transition-colors hover:bg-surface-2 disabled:opacity-30"
          disabled={!state.canGoBack}
          onClick={() => void window.vyotiq.browserBack?.()}
          title="Back"
          aria-label="Back"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Forward */}
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-fg/70 transition-colors hover:bg-surface-2 disabled:opacity-30"
          disabled={!state.canGoForward}
          onClick={() => void window.vyotiq.browserForward?.()}
          title="Forward"
          aria-label="Forward"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Reload / Stop */}
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md text-fg/70 transition-colors hover:bg-surface-2 disabled:opacity-30"
          disabled={!hasPage}
          onClick={() => void window.vyotiq.browserReload?.()}
          title={state.navigating ? 'Stop' : 'Reload'}
          aria-label={state.navigating ? 'Stop' : 'Reload'}
        >
          {state.navigating ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          )}
        </button>

        {/* Address bar */}
        <form onSubmit={handleNavigate} className="min-w-0 flex-1">
          <div
            className={cn(
              'flex items-center rounded-md border bg-surface px-2.5 py-1 text-[12px] transition-colors',
              urlFocused ? 'border-accent/60' : 'border-border/40'
            )}
          >
            {!urlFocused && hasPage ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5 shrink-0 text-muted">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : null}
            <input
              ref={urlInputRef}
              type="text"
              className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-muted"
              placeholder="Search or enter URL"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={() => {
                setUrlFocused(true)
                setTimeout(() => urlInputRef.current?.select(), 0)
              }}
              onBlur={() => {
                setUrlFocused(false)
                setUrlInput(state.url?.trim() || '')
              }}
              spellCheck={false}
            />
          </div>
        </form>

        {/* Menu (...) */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md text-fg/70 transition-colors hover:bg-surface-2"
            onClick={() => setMenuOpen((v) => !v)}
            title="More actions"
            aria-label="More actions"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] rounded-lg border border-border/60 bg-surface py-1 shadow-lg">
              <MenuButton onClick={() => handleMenuAction('reload')} disabled={!hasPage}>
                Hard Reload
              </MenuButton>
              <MenuButton onClick={() => handleMenuAction('copy-url')} disabled={!state.url}>
                Copy Current URL
              </MenuButton>
              <div className="my-1 border-t border-border/30" />
              <MenuButton onClick={() => handleMenuAction('close')} disabled={!hasPage}>
                Close Browser
              </MenuButton>
            </div>
          ) : null}
        </div>
      </div>

      {/* Viewport */}
      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 bg-bg"
        data-agent-browser-viewport
      >
        {!hasPage ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4 text-muted/40">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <p className="text-[12px] font-medium text-fg/80">No page loaded</p>
            <p className="mt-1 max-w-[16rem] text-[11px] leading-relaxed text-muted">
              Enter a URL above or use browser_navigate to open a page.
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function MenuButton({
  children,
  onClick,
  disabled
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center px-3 py-1.5 text-left text-[12px] text-fg transition-colors hover:bg-surface-2 disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
