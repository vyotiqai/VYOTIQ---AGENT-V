import { cn } from '@renderer/lib/ui'
import { useWorkspaceHotUi } from '@renderer/lib/hooks/workspaceHotUiStore'
import {
  SIDEBAR_CONTAINER,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_COLLAPSED_DARWIN,
  SIDEBAR_WIDTH_DESKTOP
} from '@renderer/lib/utils/layout'
import { ChatList } from './ChatList'
import { SidebarCollapsed } from './SidebarCollapsed'
import { SidebarCollapsedHeader, SidebarTopBar } from './SidebarTopBar'
import { SidebarFooter } from './SidebarFooter'
import type { SidebarProps } from './types'
import { useSidebarChats } from './useSidebarChats'

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
}: SidebarProps) {
  const workspaceReady = Boolean(hasWorkspace)
  const needsWorkspaceLabel = 'Open a workspace first'
  const isDarwin = window.vyotiq?.platform === 'darwin'
  const isDrawer = variant === 'drawer'
  const isCollapsed = collapsed && !isDrawer
  const hotUi = useWorkspaceHotUi(activePath)
  const sessionQuery = activePath ? hotUi.sessionQuery : sessionQueryProp

  const { filteredRuns, groupedRuns } = useSidebarChats(runs, sessionQuery)

  const clearSearch = (): void => onSessionQuery('')

  const workspacesEnabled =
    openPaths &&
    onSwitchWorkspace &&
    onCloseWorkspace &&
    onAddWorkspace &&
    workspaceHasBackgroundRun &&
    activeRuns

  const workspaceProps = workspacesEnabled
    ? {
        openPaths,
        activePath: activePath ?? null,
        activeRuns,
        onSwitch: onSwitchWorkspace,
        onClose: onCloseWorkspace,
        onAdd: onAddWorkspace,
        workspaceHasBackgroundRun
      }
    : null

  const widthClass = isDrawer
    ? SIDEBAR_WIDTH
    : isCollapsed
      ? isDarwin
        ? SIDEBAR_WIDTH_COLLAPSED_DARWIN
        : SIDEBAR_WIDTH_COLLAPSED
      : SIDEBAR_WIDTH_DESKTOP

  const afterNav = (): void => {
    if (isDrawer) onCloseDrawer()
  }

  return (
    <aside
      className={cn(
        SIDEBAR_CONTAINER,
        'flex h-full min-h-0 shrink-0 flex-col self-stretch overflow-hidden bg-bg',
        widthClass
      )}
      aria-label="Sidebar"
      data-collapsed={isCollapsed || undefined}
    >
      {isCollapsed ? (
        <SidebarCollapsedHeader
          isDrawer={isDrawer}
          isCollapsed={isCollapsed}
          isDarwin={isDarwin}
          onToggleSidebar={onToggleSidebar}
        />
      ) : (
        <SidebarTopBar
          isDrawer={isDrawer}
          isDarwin={isDarwin}
          view={view}
          harnessActive={harnessActive}
          workspaceReady={workspaceReady}
          searchRef={searchRef}
          sessionQuery={sessionQuery}
          disabledTitle={needsWorkspaceLabel}
          onToggleSidebar={onToggleSidebar}
          onSessionQuery={onSessionQuery}
          onNewChat={() => {
            clearSearch()
            onNewChat()
            afterNav()
          }}
          onOpenSettings={() => {
            clearSearch()
            onOpenSettings()
            afterNav()
          }}
          onOpenHarness={() => {
            onOpenHarness()
            afterNav()
          }}
        />
      )}

      {isCollapsed ? (
        <SidebarCollapsed
          view={view}
          harnessActive={harnessActive}
          workspaceReady={workspaceReady}
          workspaceProps={workspaceProps}
          needsWorkspaceLabel={needsWorkspaceLabel}
          onNewChat={onNewChat}
          onOpenSettings={onOpenSettings}
          onOpenHarness={onOpenHarness}
          clearSearch={clearSearch}
        />
      ) : (
        <>
          <div
            className="app-region-no-drag sidebar-scroll min-h-0 flex-1 overflow-x-hidden"
            data-sidebar-scroll
          >
            <ChatList
              workspaceReady={workspaceReady}
              sessionQuery={sessionQuery}
              filteredRuns={filteredRuns}
              groupedRuns={groupedRuns}
              runsCapped={runsCapped}
              runsError={runsError}
              onDismissRunsError={onDismissRunsError}
              activeRunId={activeRunId}
              onSelectRun={(runId) => {
                onSelectRun(runId)
                onOpenChat()
                afterNav()
              }}
              onRenameRun={onRenameRun}
              onDeleteRun={onDeleteRun}
            />
          </div>

          <SidebarFooter workspaceProps={workspaceProps} />
        </>
      )}
    </aside>
  )
}
