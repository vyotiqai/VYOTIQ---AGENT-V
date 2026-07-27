import type { RefObject } from 'react'
import type { RunSummary } from '@shared/ipc'

export type SidebarView = 'chat' | 'settings'

export type SidebarProps = {
  view: SidebarView
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
}

export type WorkspaceSwitcherProps = {
  openPaths: string[]
  activePath: string | null
  activeRuns: { runId: string; workspacePath: string }[]
  onSwitch: (path: string) => void
  onClose: (path: string) => void
  onAdd: () => void
  workspaceHasBackgroundRun: (path: string) => boolean
  collapsed?: boolean
}
