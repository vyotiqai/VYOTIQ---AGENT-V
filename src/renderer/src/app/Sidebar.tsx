import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { Icon } from '@renderer/lib/icons'
import { NavItem, SearchInput, ActionMenu, IconButton, cn } from '@renderer/lib/ui'
import type { RunSummary } from '@shared/ipc'
import { relativeTime } from '@shared/timeFormat'
import {
  SIDEBAR_SECTION_LABEL,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_COLLAPSED_DARWIN,
  SIDEBAR_WIDTH_DESKTOP,
  TITLE_BAR_HEIGHT
} from '@renderer/lib/utils/layout'
import { groupRunsByRecency } from '@renderer/lib/utils/groupRunsByRecency'
import {
  MACOS_TITLEBAR_INSET_PX,
  MACOS_TRAFFIC_LIGHT_Y
} from '@shared/windowChrome'
import { WorkspaceTabs } from './WorkspaceTabs'
import { useWorkspaceHotUi } from '@renderer/lib/hooks/workspaceHotUiStore'

function runTitle(run: RunSummary): string {
  const goal = run.goal?.trim()
  if (goal) return goal.length > 36 ? `${goal.slice(0, 36)}…` : goal
  return run.runId.slice(0, 8)
}

function runTooltip(run: RunSummary): string {
  return run.goal?.trim() || run.runId
}

function RunStatusBadge({ status }: { status: RunSummary['status'] }) {
  if (status === 'running') {
    return (
      <span className="inline-flex shrink-0 items-center" title="Running">
        <span
          className="size-1.5 rounded-full bg-secondary motion-safe:animate-pulse"
          aria-hidden
        />
        <span className="sr-only">Running</span>
      </span>
    )
  }

  const icon =
    status === 'done' ? 'check' : status === 'error' ? 'warning' : ('close' as const)
  const label =
    status === 'done' ? 'Done' : status === 'error' ? 'Error' : 'Cancelled'
  const tone =
    status === 'done'
      ? 'text-muted'
      : status === 'error'
        ? 'text-danger'
        : 'text-muted'

  return (
    <span className={cn('inline-flex shrink-0 items-center', tone)} title={label}>
      <Icon name={icon} size={10} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function ChatRow({
  run,
  active,
  onSelect,
  onRename,
  onDelete
}: {
  run: RunSummary
  active: boolean
  onSelect: () => void
  onRename: (goal: string) => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(run.goal ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const renameCancelledRef = useRef(false)

  useEffect(() => {
    if (!renaming) return
    renameCancelledRef.current = false
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [renaming])

  useEffect(() => {
    if (!renaming) setDraft(run.goal ?? '')
  }, [run.goal, renaming])

  const commitRename = (): void => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      return
    }
    const next = draft.trim()
    setRenaming(false)
    if (next && next !== (run.goal ?? '').trim()) onRename(next)
  }

  const menuItems = [
    {
      id: 'rename',
      label: 'Rename',
      icon: 'edit' as const,
      onSelect: () => {
        setMenuOpen(false)
        setRenaming(true)
      }
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: 'close' as const,
      onSelect: () => {
        setMenuOpen(false)
        if (window.confirm(`Delete "${runTitle(run)}"? This cannot be undone.`)) {
          onDelete()
        }
      }
    }
  ]

  if (renaming) {
    return (
      <div role="listitem" className="px-2.5 py-1">
        <input
          ref={inputRef}
          type="text"
          className="w-full border-0 border-b border-border-strong bg-transparent px-0 py-1.5 text-sm tracking-[var(--vy-tracking)] text-fg outline-none focus:border-fg focus:vy-focus-ring"
          value={draft}
          aria-label="Rename chat"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') {
              renameCancelledRef.current = true
              setRenaming(false)
              setDraft(run.goal ?? '')
            }
          }}
          onBlur={commitRename}
        />
      </div>
    )
  }

  const title = runTitle(run)

  return (
    <div
      role="listitem"
      className={cn(
        'group flex w-full min-w-0 items-center gap-0.5 rounded-md vy-transition',
        active ? 'bg-surface-2 text-fg-strong' : 'text-secondary hover:bg-surface hover:text-fg'
      )}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuOpen(true)
        menuBtnRef.current?.focus()
      }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 py-[7px] text-left text-sm tracking-[var(--vy-tracking)]"
        aria-current={active ? 'true' : undefined}
        title={runTooltip(run)}
        onClick={onSelect}
      >
        <RunStatusBadge status={run.status} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 text-[11px] text-muted tabular-nums">
          {relativeTime(run.updatedAt)}
        </span>
      </button>
      <ActionMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        aria-label={`Actions for ${title}`}
        placement="down"
        align="end"
        items={menuItems}
        trigger={({ ref, onClick, ...aria }) => (
          <button
            ref={(node) => {
              ref.current = node
              menuBtnRef.current = node
            }}
            type="button"
            className={cn(
              'mr-0.5 inline-grid size-6 shrink-0 place-items-center rounded vy-transition text-muted',
              'opacity-0 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100',
              // Touch / no-hover: keep the overflow control reachable.
              '[@media(hover:none)]:opacity-100',
              (menuOpen || active) && 'opacity-100 text-fg'
            )}
            aria-label={`Actions for ${title}`}
            onClick={onClick}
            {...aria}
          >
            <Icon name="sliders" size={12} />
          </button>
        )}
      />
    </div>
  )
}

function SidebarSection({
  id,
  label,
  count,
  children,
  className
}: {
  id: string
  label: string
  count?: number
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex min-h-0 flex-col', className)} aria-labelledby={id}>
      <div className="mb-1.5 flex shrink-0 items-baseline gap-2">
        <p id={id} className={SIDEBAR_SECTION_LABEL}>
          {label}
        </p>
        {typeof count === 'number' && count > 0 ? (
          <span className="rounded px-1 py-px text-[10px] tabular-nums text-muted">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  )
}

export function Sidebar({
  view,
  runs,
  runsCapped,
  runsError,
  onDismissRunsError,
  activeRunId,
  sessionQuery: sessionQueryProp,
  searchRef,
  harnessActive,
  hasWorkspace,
  openPaths,
  activePath,
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
  onRenameRun,
  onDeleteRun,
  onCloseDrawer,
  onToggleSidebar,
  collapsed = false,
  variant = 'desktop'
}: {
  view: 'chat' | 'settings'
  runs: RunSummary[]
  runsCapped?: boolean
  runsError?: string | null
  onDismissRunsError?: () => void
  activeRunId: string | null
  sessionQuery: string
  searchRef: RefObject<HTMLInputElement | null>
  harnessActive?: boolean
  hasWorkspace?: boolean
  openPaths?: string[]
  activePath?: string | null
  activeRuns?: { runId: string; workspacePath: string }[]
  onSwitchWorkspace?: (path: string) => void
  onCloseWorkspace?: (path: string) => void
  onAddWorkspace?: () => void
  workspaceHasBackgroundRun?: (path: string) => boolean
  onSessionQuery: (q: string) => void
  onOpenSettings: () => void
  onOpenChat: () => void
  onOpenHarness: () => void
  onNewChat: () => void
  onSelectRun: (runId: string) => void
  onRenameRun: (runId: string, goal: string) => void
  onDeleteRun: (runId: string) => void
  onCloseDrawer: () => void
  onToggleSidebar: () => void
  collapsed?: boolean
  variant?: 'desktop' | 'drawer'
}) {
  // Fail closed when hasWorkspace is omitted.
  const workspaceReady = Boolean(hasWorkspace)
  const needsWorkspaceLabel = 'Open a workspace first'
  const isDarwin = window.vyotiq?.platform === 'darwin'
  const isDrawer = variant === 'drawer'
  const isCollapsed = collapsed && !isDrawer
  const hotUi = useWorkspaceHotUi(activePath)
  const sessionQuery = activePath ? hotUi.sessionQuery : sessionQueryProp

  const filteredRuns = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase()
    if (!q) return runs
    return runs.filter((r) => {
      const title = (r.goal ?? r.runId).toLowerCase()
      return title.includes(q)
    })
  }, [runs, sessionQuery])

  const groupedRuns = useMemo(() => {
    if (sessionQuery.trim()) {
      return filteredRuns.length
        ? [{ id: 'today' as const, label: 'Results', runs: filteredRuns }]
        : []
    }
    return groupRunsByRecency(filteredRuns)
  }, [filteredRuns, sessionQuery])

  const runningCount = useMemo(
    () => runs.filter((r) => r.status === 'running').length,
    [runs]
  )

  const clearSearch = (): void => onSessionQuery('')

  const workspacesEnabled =
    openPaths &&
    onSwitchWorkspace &&
    onCloseWorkspace &&
    onAddWorkspace &&
    workspaceHasBackgroundRun &&
    activeRuns

  const toggleLabel = isDrawer
    ? 'Close menu'
    : isCollapsed
      ? 'Expand sidebar'
      : 'Collapse sidebar'

  const widthClass = isDrawer
    ? SIDEBAR_WIDTH
    : isCollapsed
      ? isDarwin
        ? SIDEBAR_WIDTH_COLLAPSED_DARWIN
        : SIDEBAR_WIDTH_COLLAPSED
      : SIDEBAR_WIDTH_DESKTOP

  // Collapsed macOS: grow past title-bar height so paddingTop doesn't clip the toggle.
  const headerStyle = isDarwin
    ? isCollapsed
      ? { paddingTop: MACOS_TRAFFIC_LIGHT_Y + 10 }
      : { paddingLeft: MACOS_TITLEBAR_INSET_PX }
    : undefined

  const afterNav = (): void => {
    if (isDrawer) onCloseDrawer()
  }

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 shrink-0 flex-col self-stretch overflow-hidden bg-bg',
        widthClass
      )}
      aria-label="Sidebar"
      data-collapsed={isCollapsed || undefined}
    >
      <header
        className={cn(
          'app-region-drag flex shrink-0 items-center',
          isCollapsed && isDarwin ? 'min-h-9' : TITLE_BAR_HEIGHT,
          isCollapsed ? 'justify-center px-1' : 'gap-2 px-1.5'
        )}
        style={headerStyle}
      >
        <div className="app-region-no-drag flex shrink-0 items-center">
          <IconButton
            icon={isDrawer ? 'close' : 'sidebar'}
            label={toggleLabel}
            size="md"
            variant="bare"
            aria-expanded={isDrawer ? true : !isCollapsed}
            aria-controls={isDrawer ? 'app-nav-drawer' : undefined}
            onClick={onToggleSidebar}
          />
        </div>
        {!isCollapsed ? (
          <div className="app-region-no-drag flex min-w-0 flex-1 items-center">
            <p className="m-0 truncate text-sm font-medium leading-none tracking-[var(--vy-tracking-tight)] text-fg-strong">
              Vyotiq
            </p>
          </div>
        ) : null}
      </header>

      {isCollapsed ? (
        <nav
          className="app-region-no-drag flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden px-1 py-1.5"
          aria-label="App"
        >
          {/* Primary action */}
          <NavItem
            variant="icon"
            label="New chat"
            icon="plus"
            disabled={!workspaceReady}
            title={!workspaceReady ? needsWorkspaceLabel : 'New chat'}
            onClick={() => {
              clearSearch()
              onNewChat()
            }}
          />

          {/* Open workspaces only — add / harness / search live in the expanded sidebar */}
          {workspacesEnabled && openPaths.length > 0 ? (
            <div className="mt-1.5 flex w-full flex-col items-center gap-0.5">
              <WorkspaceTabs
                collapsed
                openPaths={openPaths}
                activePath={activePath ?? null}
                activeRuns={activeRuns}
                onSwitch={onSwitchWorkspace}
                onClose={onCloseWorkspace}
                onAdd={onAddWorkspace}
                workspaceHasBackgroundRun={workspaceHasBackgroundRun}
              />
            </div>
          ) : null}

          <div className="mt-auto flex flex-col items-center pt-2">
            <NavItem
              variant="icon"
              label="Settings"
              icon="gear"
              active={view === 'settings'}
              current={view === 'settings'}
              onClick={() => {
                clearSearch()
                onOpenSettings()
              }}
            />
          </div>
        </nav>
      ) : (
        <nav
          className="app-region-no-drag flex min-h-0 flex-1 flex-col overflow-hidden"
          aria-label="App"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-2 pb-2 pt-2.5">
            {workspacesEnabled ? (
              <SidebarSection id="workspaces-heading" label="Workspaces" className="shrink-0">
                <WorkspaceTabs
                  openPaths={openPaths}
                  activePath={activePath ?? null}
                  activeRuns={activeRuns}
                  onSwitch={onSwitchWorkspace}
                  onClose={onCloseWorkspace}
                  onAdd={onAddWorkspace}
                  workspaceHasBackgroundRun={workspaceHasBackgroundRun}
                />
              </SidebarSection>
            ) : null}

            <SidebarSection id="navigate-heading" label="Navigate" className="shrink-0">
              <div className="flex flex-col gap-px">
                <NavItem
                  label="New chat"
                  icon="plus"
                  disabled={!workspaceReady}
                  title={!workspaceReady ? needsWorkspaceLabel : undefined}
                  onClick={() => {
                    clearSearch()
                    onNewChat()
                    afterNav()
                  }}
                />
                <NavItem
                  label="Settings"
                  icon="gear"
                  active={view === 'settings'}
                  current={view === 'settings'}
                  onClick={() => {
                    clearSearch()
                    onOpenSettings()
                    afterNav()
                  }}
                />
                <NavItem
                  label="Harness"
                  icon="doc"
                  active={harnessActive}
                  pressed={harnessActive}
                  onClick={() => {
                    onOpenHarness()
                    afterNav()
                  }}
                />
              </div>
            </SidebarSection>

            <SidebarSection
              id="chats-heading"
              label="Chats"
              count={workspaceReady ? filteredRuns.length : undefined}
              className="min-h-0 flex-1"
            >
              {workspaceReady ? (
                <div className="mb-2 shrink-0">
                  <SearchInput
                    ref={searchRef}
                    tone="quiet"
                    placeholder="Search chats"
                    value={sessionQuery}
                    onChange={(e) => onSessionQuery(e.target.value)}
                    onClear={sessionQuery ? () => onSessionQuery('') : undefined}
                    aria-label="Search chats"
                    aria-keyshortcuts="Meta+K Control+K"
                  />
                </div>
              ) : null}

              {runningCount > 0 && workspaceReady && !sessionQuery.trim() ? (
                <p className="m-0 mb-1.5 px-2.5 text-[11px] text-secondary">
                  {runningCount} running
                </p>
              ) : null}

              <div
                className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
                role="region"
                aria-labelledby="chats-heading"
              >
                {runsError ? (
                  <div className="mb-1.5 flex items-start gap-1.5 px-1 py-1.5" role="alert">
                    <p className="m-0 min-w-0 flex-1 text-sm text-danger">{runsError}</p>
                    {onDismissRunsError ? (
                      <button
                        type="button"
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted vy-transition hover:bg-surface hover:text-fg"
                        onClick={onDismissRunsError}
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {filteredRuns.length === 0 ? (
                  <p className="m-0 px-2.5 py-2 text-sm text-secondary">
                    {!workspaceReady
                      ? 'Open a workspace to see chats'
                      : sessionQuery.trim()
                        ? 'No matching chats'
                        : 'No chats yet'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {groupedRuns.map((group) => (
                      <div key={group.id} className="flex flex-col gap-px">
                        {groupedRuns.length > 1 || group.label === 'Results' ? (
                          <p className="m-0 px-2.5 pb-1 text-[11px] text-muted">
                            {group.label}
                          </p>
                        ) : null}
                        <div className="flex flex-col gap-0.5" role="list">
                          {group.runs.map((run) => (
                            <ChatRow
                              key={run.runId}
                              run={run}
                              active={activeRunId === run.runId}
                              onSelect={() => {
                                onSelectRun(run.runId)
                                onOpenChat()
                                afterNav()
                              }}
                              onRename={(goal) => onRenameRun(run.runId, goal)}
                              onDelete={() => onDeleteRun(run.runId)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {runsCapped && !sessionQuery.trim() ? (
                  <p className="m-0 px-2.5 py-2 text-[11px] text-muted">
                    Showing 30 most recent
                  </p>
                ) : null}
              </div>
            </SidebarSection>
          </div>

          <div className="flex shrink-0 items-center gap-2.5 px-3 py-2.5">
            <div
              className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-medium tracking-[-0.02em] text-fg-strong"
              aria-hidden
            >
              V
            </div>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-sm leading-tight tracking-[var(--vy-tracking)] text-fg-strong">
                Local agent
              </p>
              <p className="m-0 truncate text-[11px] leading-tight tracking-[var(--vy-tracking)] text-secondary">
                {workspaceReady
                  ? activePath
                    ? activePath.split(/[/\\]/).filter(Boolean).at(-1) ?? 'Ready'
                    : 'Ready'
                  : 'No workspace'}
              </p>
            </div>
          </div>
        </nav>
      )}
    </aside>
  )
}
