import type { WorkspaceSwitcherProps } from './types'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

export function SidebarFooter({
  workspaceProps
}: {
  workspaceProps: WorkspaceSwitcherProps | null
}) {
  if (!workspaceProps) return null

  return (
    <footer className="shrink-0 border-t border-border/30 px-1 py-1">
      <WorkspaceSwitcher {...workspaceProps} />
    </footer>
  )
}
