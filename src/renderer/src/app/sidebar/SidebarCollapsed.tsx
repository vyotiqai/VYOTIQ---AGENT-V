import { NavItem } from '@renderer/lib/ui'
import type { SidebarView } from './types'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import type { WorkspaceSwitcherProps } from './types'

export function SidebarCollapsed({
  view,
  harnessActive,
  workspaceReady,
  workspaceProps,
  needsWorkspaceLabel,
  onNewChat,
  onOpenSettings,
  onOpenHarness,
  clearSearch
}: {
  view: SidebarView
  harnessActive?: boolean
  workspaceReady: boolean
  workspaceProps: WorkspaceSwitcherProps | null
  needsWorkspaceLabel: string
  onNewChat: () => void
  onOpenSettings: () => void
  onOpenHarness: () => void
  clearSearch: () => void
}) {
  return (
    <nav
      className="app-region-no-drag sidebar-scroll flex min-h-0 flex-1 flex-col items-center gap-1 px-1 py-2"
      aria-label="App"
    >
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

      {workspaceProps && workspaceProps.openPaths.length > 0 ? (
        <WorkspaceSwitcher {...workspaceProps} collapsed />
      ) : null}

      <div className="mt-auto flex flex-col items-center gap-1">
        <NavItem
          variant="icon"
          label="Harness"
          icon="doc"
          active={harnessActive}
          pressed={harnessActive}
          onClick={onOpenHarness}
        />
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
  )
}
