import { IconButton, cn } from '@renderer/lib/ui'
import { CHAT_SIDE_RAIL_WIDTH, type ChatRightPanelId } from '@renderer/lib/utils/layout'
import type { IconName } from '@renderer/lib/icons'

const RAIL_ITEMS: Array<{
  id: ChatRightPanelId
  icon: IconName
  showLabel: string
  hideLabel: string
}> = [
  { id: 'browser', icon: 'globe', showLabel: 'Show browser panel', hideLabel: 'Hide browser panel' },
  {
    id: 'terminal',
    icon: 'terminal',
    showLabel: 'Show terminal panel',
    hideLabel: 'Hide terminal panel'
  },
  {
    id: 'changes',
    icon: 'branch',
    showLabel: 'Show changes panel',
    hideLabel: 'Hide changes panel'
  },
  {
    id: 'plan',
    icon: 'listTodo',
    showLabel: 'Show plan panel',
    hideLabel: 'Hide plan panel'
  }
]

/**
 * Floating right rail for toggling chat secondary panels.
 * Overlays the pane edge so the transcript can scroll edge-to-edge (scrollbar
 * sits under the rail rather than stopping short of it).
 */
export function ChatSideRail({
  activePanel,
  browserActive,
  onSelectPanel,
  className
}: {
  activePanel: ChatRightPanelId | null
  /** True when the agent browser has a live page (even if panel closed). */
  browserActive?: boolean
  onSelectPanel: (panel: ChatRightPanelId) => void
  className?: string
}) {
  return (
    <aside
      className={cn(
        'pointer-events-none absolute inset-y-0 right-0 z-sticky flex h-full flex-col items-center justify-start gap-1 bg-gradient-to-l from-bg via-bg/80 to-transparent pt-2',
        CHAT_SIDE_RAIL_WIDTH,
        className
      )}
      data-chat-side-rail
      aria-label="Panels"
    >
      {RAIL_ITEMS.map((item) => {
        const open = activePanel === item.id
        const accent = item.id === 'browser' && browserActive && !open
        return (
          <div key={item.id} className="pointer-events-auto relative">
            <IconButton
              icon={item.icon}
              label={open ? item.hideLabel : item.showLabel}
              variant="bare"
              size="sm"
              aria-pressed={open}
              className={cn(
                'text-muted hover:text-fg',
                open && 'text-fg',
                accent && 'text-accent'
              )}
              onClick={() => onSelectPanel(item.id)}
            />
            {accent ? (
              <span
                className="pointer-events-none absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent"
                aria-hidden
              />
            ) : null}
          </div>
        )
      })}
    </aside>
  )
}
