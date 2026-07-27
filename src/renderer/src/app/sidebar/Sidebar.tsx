import { cn } from '@renderer/lib/ui'
import { useWorkspaceHotUi } from '@renderer/lib/hooks/workspaceHotUiStore'
import { useEffect, useState } from 'react'
import {
  SIDEBAR_CONTAINER,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_DESKTOP
} from '@renderer/lib/utils/layout'
import { ChatList } from './ChatList'
import { SidebarTopBar } from './SidebarTopBar'
import type { SidebarProps } from './types'
import { useSidebarChats } from './useSidebarChats'

export function Sidebar({
  view,
  onDismissRunsError,
  sessionQuery: sessionQueryProp,
  searchRef,
  hasWorkspace,
  openPaths,
  activePath,
  runsByWorkspacePath,
  activeRuns,
  onSwitchWorkspace,
  onCloseWorkspace,
  onAddWorkspace,
  workspaceHasBackgroundRun,
  onSessionQuery,
  onOpenSettings,
  onOpenChat,
  onNewChat,
  onSelectRun,
  onSelectRunInWorkspace,
  onRenameRun,
  onRenameRunInWorkspace,
  onDeleteRun,
  onDeleteRunInWorkspace,
  onCloseDrawer,
  onToggleSidebar,
  variant = 'desktop'
}: SidebarProps) {
  const workspaceReady = Boolean(hasWorkspace)
  const needsWorkspaceLabel = 'Open a workspace first'
  const isDarwin = window.vyotiq?.platform === 'darwin'
  const isDrawer = variant === 'drawer'
  const hotUi = useWorkspaceHotUi(activePath)
  const sessionQuery = activePath ? hotUi.sessionQuery : sessionQueryProp
  const [expandedByPath, setExpandedByPath] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!openPaths?.length) return
    setExpandedByPath((prev) => {
      const next: Record<string, boolean> = {}
      for (const path of openPaths) {
        next[path] = prev[path] ?? path === activePath
      }
      return next
    })
  }, [activePath, openPaths])

  const { filteredRuns, workspaceGroups } = useSidebarChats({
    openPaths: openPaths ?? [],
    activePath: activePath ?? null,
    sessionQuery,
    runsByWorkspacePath: runsByWorkspacePath ?? {},
    expandedByPath
  })

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

  const widthClass = isDrawer ? SIDEBAR_WIDTH : SIDEBAR_WIDTH_DESKTOP

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
    >
      <SidebarTopBar
        isDrawer={isDrawer}
        isDarwin={isDarwin}
        view={view}
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
      />

      <div
        className="app-region-no-drag sidebar-scroll min-h-0 flex-1 overflow-x-hidden"
        data-sidebar-scroll
      >
            <ChatList
              workspaceReady={workspaceReady}
              sessionQuery={sessionQuery}
              filteredRunsCount={filteredRuns.length}
              workspaceGroups={workspaceGroups}
              onToggleWorkspace={(path) =>
                setExpandedByPath((prev) => ({ ...prev, [path]: !(prev[path] ?? false) }))
              }
              onSwitchWorkspace={(path) => {
                setExpandedByPath((prev) => ({ ...prev, [path]: true }))
                onSwitchWorkspace?.(path)
              }}
              onCloseWorkspace={(path) => onCloseWorkspace?.(path)}
              onAddWorkspace={() => onAddWorkspace?.()}
              workspaceHasBackgroundRun={(path) => workspaceHasBackgroundRun?.(path) ?? false}
              onDismissRunsError={(path) => onDismissRunsError?.(path)}
              onSelectRun={(path, runId) => {
                setExpandedByPath((prev) => ({ ...prev, [path]: true }))
                if (onSelectRunInWorkspace) onSelectRunInWorkspace(path, runId)
                else onSelectRun(runId)
                onOpenChat()
                afterNav()
              }}
              onRenameRun={(path, runId, goal) => {
                if (onRenameRunInWorkspace) onRenameRunInWorkspace(path, runId, goal)
                else onRenameRun(runId, goal)
              }}
              onDeleteRun={(path, runId) => {
                if (onDeleteRunInWorkspace) onDeleteRunInWorkspace(path, runId)
                else onDeleteRun(runId)
              }}
            />
          </div>
    </aside>
  )
}
