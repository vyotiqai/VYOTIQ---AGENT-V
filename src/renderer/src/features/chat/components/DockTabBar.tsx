import { useEffect, useMemo, useRef, useState } from 'react'
import { IconButton, cn } from '@renderer/lib/ui'
import { Icon, type IconName } from '@renderer/lib/icons'
import type { ChatRightPanelId } from '@renderer/lib/utils/layout'
import { DOCK_PANELS, dockPanelDef } from '@renderer/lib/utils/dockPanels'

export type DockTabItem = {
  id: ChatRightPanelId
  label: string
  icon: IconName
}

const ADDABLE: DockTabItem[] = DOCK_PANELS.map((p) => ({
  id: p.id,
  label: p.label,
  icon: p.icon
}))

/**
 * Cursor-style horizontal tabs above the active right dock panel.
 * Side rail still toggles panels; this bar switches among open types.
 */
export function DockTabBar({
  active,
  tabs,
  onSelect,
  onCloseTab,
  onOpenPanel,
  expanded,
  onToggleExpanded,
  className
}: {
  active: ChatRightPanelId
  tabs: DockTabItem[]
  onSelect: (id: ChatRightPanelId) => void
  onCloseTab: (id: ChatRightPanelId) => void
  onOpenPanel: (id: ChatRightPanelId) => void
  expanded?: boolean
  onToggleExpanded?: () => void
  className?: string
}) {
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)

  const openIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs])
  const addable = useMemo(() => ADDABLE.filter((t) => !openIds.has(t.id)), [openIds])

  useEffect(() => {
    if (!addOpen) return undefined
    const onDoc = (e: MouseEvent): void => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [addOpen])

  return (
    <div
      className={cn(
        'flex min-w-0 shrink-0 items-center gap-0.5 border-b border-border/40 bg-bg px-1 py-0.5',
        className
      )}
      data-dock-tab-bar
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.id === active
          return (
            <div
              key={tab.id}
              className={cn(
                'group inline-flex max-w-[9rem] shrink-0 items-center gap-0.5 rounded-md pl-2 pr-0.5 py-0.5 text-[11px]',
                selected
                  ? 'bg-surface font-medium text-fg'
                  : 'text-muted hover:bg-surface/60 hover:text-fg'
              )}
            >
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-1 truncate"
                aria-pressed={selected}
                onClick={() => onSelect(tab.id)}
              >
                <Icon name={tab.icon} size={12} className="shrink-0 text-muted" />
                <span className="truncate">{tab.label}</span>
              </button>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 opacity-0 hover:bg-surface-2 focus-visible:opacity-100 focus-visible:vy-focus-ring group-hover:opacity-100 group-focus-within:opacity-100"
                aria-label={`Close ${tab.label}`}
                onClick={() => onCloseTab(tab.id)}
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          )
        })}
      </div>
      <div className="relative flex shrink-0 items-center gap-0.5" ref={addRef}>
        {addable.length > 0 ? (
          <>
            <IconButton
              icon="plus"
              label="Open panel"
              variant="bare"
              size="sm"
              className="text-muted"
              onClick={() => setAddOpen((v) => !v)}
            />
            {addOpen ? (
              <div
                className="absolute right-0 top-full z-dropdown mt-0.5 min-w-[10rem] rounded-md border border-border bg-bg py-1 shadow-lg"
                role="menu"
              >
                {addable.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11px] text-fg hover:bg-surface-2"
                    onClick={() => {
                      onOpenPanel(item.id)
                      setAddOpen(false)
                    }}
                  >
                    <Icon name={item.icon} size={12} className="text-muted" />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        {onToggleExpanded ? (
          <IconButton
            icon={expanded ? 'minimize' : 'maximize'}
            label={expanded ? 'Collapse panel' : 'Expand panel'}
            variant="bare"
            size="sm"
            className="text-muted"
            onClick={onToggleExpanded}
          />
        ) : null}
      </div>
    </div>
  )
}

export function defaultDockTab(id: ChatRightPanelId, prNumber?: number | null): DockTabItem {
  const def = dockPanelDef(id)
  if (id === 'pr' && prNumber != null) {
    return { id, label: `PR #${prNumber}`, icon: def.icon }
  }
  return { id, label: def.label, icon: def.icon }
}
