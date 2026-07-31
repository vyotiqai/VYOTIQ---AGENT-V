import { useEffect, useMemo, useRef, useState } from 'react'
import { IconButton, cn } from '@renderer/lib/ui'
import { Icon, type IconName } from '@renderer/lib/icons'
import type { ChatRightPanelId, DockImmersiveTabId } from '@renderer/lib/utils/layout'
import { DOCK_PANELS, dockPanelDef } from '@renderer/lib/utils/dockPanels'
import { handleTabListKeyDown } from '@renderer/lib/utils/tabListKeyboard'

export type DockTabItem = {
  id: DockImmersiveTabId
  label: string
  icon: IconName
  /** When false, omit the close control (Agent tab). Defaults to true for panel tabs. */
  closable?: boolean
}

const ADDABLE: DockTabItem[] = DOCK_PANELS.map((p) => ({
  id: p.id,
  label: p.label,
  icon: p.icon
}))

export const AGENT_DOCK_TAB: DockTabItem = {
  id: 'agent',
  label: 'Agent',
  icon: 'bot',
  closable: false
}

/**
 * Cursor-style horizontal tabs above the active right dock panel.
 * Immersive variant: pill active chip, Agent tab, + add — unified with the agent column.
 */
export function DockTabBar({
  active,
  tabs,
  onSelect,
  onCloseTab,
  onOpenPanel,
  expanded,
  onToggleExpanded,
  variant = 'dock',
  className
}: {
  active: DockImmersiveTabId
  tabs: DockTabItem[]
  onSelect: (id: DockImmersiveTabId) => void
  onCloseTab: (id: ChatRightPanelId) => void
  onOpenPanel: (id: ChatRightPanelId) => void
  expanded?: boolean
  onToggleExpanded?: () => void
  variant?: 'dock' | 'immersive'
  className?: string
}) {
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)
  const immersive = variant === 'immersive'

  const openIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs])
  const addable = useMemo(() => ADDABLE.filter((t) => !openIds.has(t.id)), [openIds])
  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs])

  useEffect(() => {
    if (!addOpen) return undefined
    const onDoc = (e: MouseEvent): void => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setAddOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [addOpen])

  return (
    <div
      className={cn(
        'flex min-w-0 shrink-0 items-center gap-0.5 border-b border-border/40 bg-bg px-1.5 py-1',
        className
      )}
      data-dock-tab-bar
      data-dock-tab-variant={variant}
    >
      <div
        className="sidebar-scroll-x flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        aria-label={immersive ? 'Agent and panels' : 'Panels'}
        onKeyDown={(e) =>
          handleTabListKeyDown(e, {
            tabs: tabIds,
            activeId: active,
            onSelect: (id) => onSelect(id as DockImmersiveTabId)
          })
        }
      >
        {tabs.map((tab) => {
          const selected = tab.id === active
          const closable = tab.closable !== false && tab.id !== 'agent'
          return (
            <div
              key={tab.id}
              className={cn(
                'group inline-flex max-w-[9rem] shrink-0 items-center',
                immersive ? 'rounded-full' : 'rounded-md',
                selected ? 'bg-surface' : 'hover:bg-surface/60'
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={cn(
                  'inline-flex min-w-0 items-center gap-1 truncate py-1 text-[11px] focus-visible:vy-focus-ring',
                  immersive ? 'rounded-full' : 'rounded-md',
                  closable ? 'pl-2.5 pr-0.5' : 'px-2.5',
                  selected ? 'font-medium text-fg' : 'text-muted hover:text-fg'
                )}
                onClick={() => onSelect(tab.id)}
              >
                {/* Immersive Agent matches Cursor Image tab: label then glyph. */}
                {immersive && tab.id === 'agent' ? (
                  <>
                    <span className="truncate">{tab.label}</span>
                    <Icon
                      name={tab.icon}
                      size={12}
                      className={cn('shrink-0', selected ? 'text-fg' : 'text-muted')}
                    />
                  </>
                ) : (
                  <>
                    <Icon
                      name={tab.icon}
                      size={12}
                      className={cn('shrink-0', selected ? 'text-fg' : 'text-muted')}
                    />
                    <span className="truncate">{tab.label}</span>
                  </>
                )}
              </button>
              {closable ? (
                <button
                  type="button"
                  className={cn(
                    'mr-0.5 shrink-0 rounded-full p-0.5 focus-visible:opacity-100 focus-visible:vy-focus-ring',
                    selected
                      ? 'opacity-70 hover:bg-surface-2 hover:opacity-100'
                      : 'opacity-0 hover:bg-surface-2 group-hover:opacity-100 group-focus-within:opacity-100'
                  )}
                  aria-label={`Close ${tab.label}`}
                  tabIndex={-1}
                  onClick={() => {
                    if (tab.id !== 'agent') onCloseTab(tab.id)
                  }}
                >
                  <Icon name="close" size={10} />
                </button>
              ) : null}
            </div>
          )
        })}
        {immersive && addable.length > 0 ? (
          <div className="relative shrink-0" ref={addRef}>
            <IconButton
              icon="plus"
              label="Add panel"
              variant="bare"
              size="sm"
              className="text-muted"
              aria-expanded={addOpen}
              aria-haspopup="menu"
              onClick={() => setAddOpen((v) => !v)}
            />
            {addOpen ? (
              <div
                className="absolute left-0 top-full z-dropdown mt-0.5 min-w-[10rem] rounded-md border border-border bg-bg py-1 shadow-lg"
                role="menu"
              >
                {addable.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11px] text-fg hover:bg-surface-2"
                    onClick={() => {
                      if (item.id !== 'agent') onOpenPanel(item.id)
                      setAddOpen(false)
                    }}
                  >
                    <Icon name={item.icon} size={12} className="text-muted" />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="relative flex shrink-0 items-center gap-0.5" ref={immersive ? undefined : addRef}>
        {!immersive && addable.length > 0 ? (
          <>
            <IconButton
              icon="panels"
              label="Open panel"
              variant="bare"
              size="sm"
              className="text-muted"
              aria-expanded={addOpen}
              aria-haspopup="menu"
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
                      if (item.id !== 'agent') onOpenPanel(item.id)
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
