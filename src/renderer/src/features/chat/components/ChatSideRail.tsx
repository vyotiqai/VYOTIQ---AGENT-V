import { IconButton, cn } from '@renderer/lib/ui'
import type { ChatRightPanelId } from '@renderer/lib/utils/layout'
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
  { id: 'files', icon: 'file', showLabel: 'Show files panel', hideLabel: 'Hide files panel' },
  {
    id: 'changes',
    icon: 'branch',
    showLabel: 'Show changes panel',
    hideLabel: 'Hide changes panel'
  }
]

/**
 * In-layout right rail for toggling chat secondary panels.
 * Kept non-overlay to avoid layout/position inconsistencies.
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
        'flex h-full w-10 shrink-0 flex-col items-center justify-start gap-1 pt-2',
        className
      )}
      data-chat-side-rail
      aria-label="Panels"
    >
      {RAIL_ITEMS.map((item) => {
        const open = activePanel === item.id
        const accent = item.id === 'browser' && browserActive && !open
        return (
          <div key={item.id} className="relative">
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
