import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import { Sidebar } from './sidebar'
import { BreakpointProvider, useIsDesktop } from '@renderer/lib/context/BreakpointProvider'
import { useOverlayPanel } from '@renderer/lib/hooks/useOverlayPanel'
import { usePersistedBoolean } from '@renderer/lib/hooks/usePersistedBoolean'
import { getWorkspaceHotUi } from '@renderer/lib/hooks/workspaceHotUiStore'
import type { RunSummary } from '@shared/ipc'
import type { WorkspaceSidebarRuns } from './sidebar/types'
import { SIDEBAR_COLLAPSED_KEY, TITLE_BAR_HEIGHT_PX } from '@renderer/lib/utils/layout'
import { TitleBar } from './TitleBar'

function AppShellInner({
  view,
  workspacePath,
  openWorkspaces,
  runsByWorkspacePath,
  activeRuns,
  runs,
  runsCapped,
  runsError,
  onDismissRunsError,
  activeRunId,
  sessionQuery,
  harnessActive,
  onSessionQuery,
  onOpenSettings,
  onOpenChat,
  onOpenHarness,
  onNewChat,
  onSelectRun,
  onSelectRunInWorkspace,
  onRenameRun,
  onRenameRunInWorkspace,
  onDeleteRun,
  onDeleteRunInWorkspace,
  onSwitchWorkspace,
  onCloseWorkspace,
  onAddWorkspace,
  workspaceHasBackgroundRun,
  children,
  loading
}: {
  view: 'chat' | 'settings'
  workspacePath: string | null
  openWorkspaces?: string[]
  runsByWorkspacePath?: Record<string, WorkspaceSidebarRuns>
  activeRuns?: { runId: string; workspacePath: string }[]
  runs: RunSummary[]
  runsCapped?: boolean
  runsError?: string | null
  onDismissRunsError?: (path?: string) => void
  activeRunId: string | null
  sessionQuery: string
  harnessActive?: boolean
  onSessionQuery: (q: string) => void
  onOpenSettings: () => void
  onOpenChat: () => void
  onOpenHarness: () => void
  onNewChat: () => void
  onSelectRun: (runId: string) => void
  onSelectRunInWorkspace?: (path: string, runId: string) => void
  onRenameRun: (runId: string, goal: string) => void
  onRenameRunInWorkspace?: (path: string, runId: string, goal: string) => void
  onDeleteRun: (runId: string) => void
  onDeleteRunInWorkspace?: (path: string, runId: string) => void
  onSwitchWorkspace?: (path: string) => void
  onCloseWorkspace?: (path: string) => void
  onAddWorkspace?: () => void
  workspaceHasBackgroundRun?: (path: string) => boolean
  children: ReactNode
  loading?: boolean
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedBoolean(
    SIDEBAR_COLLAPSED_KEY,
    false
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const pendingSearchFocusRef = useRef(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const drawerTriggerRef = useRef<HTMLElement | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const isDesktop = useIsDesktop()

  const closeDrawer = useCallback((): void => setDrawerOpen(false), [])

  const onToggleSidebar = useCallback((): void => {
    drawerTriggerRef.current = document.activeElement as HTMLElement | null
    if (isDesktop) {
      setSidebarCollapsed((v) => !v)
      setDrawerOpen(false)
    } else {
      setDrawerOpen((v) => !v)
    }
  }, [isDesktop, setSidebarCollapsed])

  const focusSearchInput = useCallback((): boolean => {
    const el = searchRef.current
    if (!el) return false
    el.focus()
    try {
      el.select()
    } catch {
      // jsdom / non-text inputs may reject select()
    }
    return document.activeElement === el
  }, [])

  const focusSearch = useCallback((): void => {
    if (isDesktop) {
      if (sidebarCollapsed) {
        pendingSearchFocusRef.current = true
        setSidebarCollapsed(false)
        return
      }
    } else if (!drawerOpen) {
      pendingSearchFocusRef.current = true
      drawerTriggerRef.current = document.activeElement as HTMLElement | null
      setDrawerOpen(true)
      return
    }
    if (!focusSearchInput()) {
      pendingSearchFocusRef.current = true
    }
  }, [
    isDesktop,
    sidebarCollapsed,
    drawerOpen,
    setSidebarCollapsed,
    focusSearchInput
  ])

  const hasWorkspace =
    Boolean(workspacePath) || (openWorkspaces?.length ?? 0) > 0

  useEffect(() => {
    if (isDesktop) setDrawerOpen(false)
  }, [isDesktop])

  useEffect(() => {
    if (!hasWorkspace) onSessionQuery('')
  }, [hasWorkspace, onSessionQuery])

  // Focus search after expand/drawer mount — single rAF is too early for the new tree.
  useEffect(() => {
    if (!pendingSearchFocusRef.current) return
    if (isDesktop ? sidebarCollapsed : !drawerOpen) return
    if (!hasWorkspace) {
      pendingSearchFocusRef.current = false
      return
    }

    let cancelled = false
    let attempts = 0
    const tryFocus = (): void => {
      if (cancelled) return
      if (focusSearchInput()) {
        pendingSearchFocusRef.current = false
        return
      }
      if (attempts++ < 16) {
        window.setTimeout(tryFocus, 0)
      } else {
        pendingSearchFocusRef.current = false
      }
    }
    window.setTimeout(tryFocus, 0)
    return () => {
      cancelled = true
    }
  }, [sidebarCollapsed, drawerOpen, isDesktop, hasWorkspace, focusSearchInput])

  useEffect(() => {
    if (drawerOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[aria-expanded="true"][aria-haspopup]')) return
      if (!getWorkspaceHotUi(workspacePath).sessionQuery.trim()) return
      e.preventDefault()
      e.stopPropagation()
      onSessionQuery('')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drawerOpen, workspacePath, onSessionQuery])

  useOverlayPanel({
    open: drawerOpen,
    onClose: closeDrawer,
    panelRef: drawerRef,
    inertTargetRef: mainRef,
    restoreFocusRef: drawerTriggerRef
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey) return
      const key = e.key.toLowerCase()

      if (key === 'b') {
        e.preventDefault()
        onToggleSidebar()
        return
      }

      if (key === 'k') {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          (e.target as HTMLElement)?.isContentEditable
        ) {
          if (document.activeElement === searchRef.current) {
            e.preventDefault()
            onSessionQuery('')
            searchRef.current?.blur()
          }
          return
        }
        e.preventDefault()
        focusSearch()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onToggleSidebar, focusSearch, onSessionQuery])

  const sidebarProps = {
    view,
    runs,
    runsCapped,
    runsError,
    onDismissRunsError,
    activeRunId,
    sessionQuery,
    searchRef,
    harnessActive,
    hasWorkspace,
    openPaths: openWorkspaces,
    activePath: workspacePath,
    runsByWorkspacePath,
    activeRuns,
    onSwitchWorkspace,
    onCloseWorkspace,
    onAddWorkspace,
    workspaceHasBackgroundRun,
    onSessionQuery,
    onOpenSettings,
    onOpenChat,
    onOpenHarness,
    onNewChat,
    onSelectRun,
    onSelectRunInWorkspace,
    onRenameRun,
    onRenameRunInWorkspace,
    onDeleteRun,
    onDeleteRunInWorkspace,
    onCloseDrawer: closeDrawer,
    onToggleSidebar,
    onFocusSearch: focusSearch
  }

  return (
    <div className="flex h-full overflow-hidden bg-bg text-fg">
      {/* Mount only on desktop so searchRef is never bound to a hidden sibling. */}
      {isDesktop ? (
        <div className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden self-stretch">
          <Sidebar {...sidebarProps} collapsed={sidebarCollapsed} />
        </div>
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col self-stretch">
        <TitleBar drawerOpen={drawerOpen} onToggleSidebar={onToggleSidebar} />

        {drawerOpen && !isDesktop ? (
          <div
            ref={drawerRef}
            id="app-nav-drawer"
            className="absolute inset-x-0 bottom-0 z-drawer flex outline-none"
            style={{ top: TITLE_BAR_HEIGHT_PX }}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
          >
            <div
              className="absolute inset-0 bg-overlay animate-fade-in"
              data-overlay-scrim
              aria-hidden
              onClick={closeDrawer}
            />
            <div className="relative z-sticky h-full min-h-0 animate-slide-in-left">
              <Sidebar {...sidebarProps} variant="drawer" />
            </div>
          </div>
        ) : null}

        <main
          ref={mainRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg outline-none"
          id="main"
          tabIndex={-1}
          aria-busy={loading ? true : undefined}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

export function AppShell(
  props: Parameters<typeof AppShellInner>[0]
): ReactElement {
  return (
    <BreakpointProvider>
      <AppShellInner {...props} />
    </BreakpointProvider>
  )
}
