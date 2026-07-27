import type { RefObject } from 'react'
import { IconButton, cn } from '@renderer/lib/ui'
import { TITLE_BAR_HEIGHT } from '@renderer/lib/utils/layout'
import { MACOS_TITLEBAR_INSET_PX } from '@shared/windowChrome'
import type { SidebarView } from './types'
import { SidebarSearchChrome } from './SidebarSearchChrome'

export function SidebarTopBar({
  isDrawer,
  isDarwin,
  view,
  workspaceReady,
  searchRef,
  sessionQuery,
  disabledTitle,
  onToggleSidebar,
  onSessionQuery,
  onNewChat,
  onOpenSettings
}: {
  isDrawer: boolean
  isDarwin: boolean
  view: SidebarView
  workspaceReady: boolean
  searchRef: RefObject<HTMLInputElement | null>
  sessionQuery: string
  disabledTitle?: string
  onToggleSidebar: () => void
  onSessionQuery: (q: string) => void
  onNewChat: () => void
  onOpenSettings: () => void
}) {
  const headerStyle = isDarwin ? { paddingLeft: MACOS_TITLEBAR_INSET_PX } : undefined

  return (
    <header
      className={cn(
        'app-region-drag flex shrink-0 items-center gap-0.5 px-1',
        TITLE_BAR_HEIGHT
      )}
      style={headerStyle}
    >
      {isDrawer ? (
        <div className="app-region-no-drag shrink-0">
          <IconButton
            icon="close"
            label="Close menu"
            size="sm"
            variant="bare"
            aria-expanded
            aria-controls="app-nav-drawer"
            onClick={onToggleSidebar}
          />
        </div>
      ) : null}

      <div className="app-region-no-drag min-w-0 flex-1">
        <SidebarSearchChrome
          searchRef={searchRef}
          sessionQuery={sessionQuery}
          workspaceReady={workspaceReady}
          disabledTitle={disabledTitle}
          view={view}
          onSessionQuery={onSessionQuery}
          onNewChat={onNewChat}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </header>
  )
}
