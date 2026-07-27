import { NavItem } from '@renderer/lib/ui'
import { searchShortcutLabel } from '@renderer/lib/utils/searchShortcut'
import type { SidebarView } from './types'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import type { WorkspaceSwitcherProps } from './types'

export function SidebarCollapsed({
  view,
  workspaceReady,
  workspaceProps,
  needsWorkspaceLabel,
  onNewChat,
  onOpenSettings,
  onFocusSearch,
  clearSearch
}: {
  view: SidebarView
  workspaceReady: boolean
  workspaceProps: WorkspaceSwitcherProps | null
  needsWorkspaceLabel: string
  onNewChat: () => void
  onOpenSettings: () => void
  onFocusSearch?: () => void
  clearSearch: () => void
}) {
  const searchTitle = `Search chats (${searchShortcutLabel()})`

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
      <NavItem
        variant="icon"
        label="Search chats"
        icon="search"
        disabled={!workspaceReady || !onFocusSearch}
        title={!workspaceReady ? needsWorkspaceLabel : searchTitle}
        onClick={() => onFocusSearch?.()}
      />

      {workspaceProps ? <WorkspaceSwitcher {...workspaceProps} collapsed /> : null}

      <div className="mt-auto flex flex-col items-center gap-1">
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
