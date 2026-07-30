import { useEffect, useMemo, useRef, useState } from 'react'
import { IconButton, cn } from '@renderer/lib/ui'
import { Icon, type IconName } from '@renderer/lib/icons'
import type { ChatRightPanelId } from '@renderer/lib/utils/layout'

export type DockTabItem = {
  id: ChatRightPanelId
  label: string
  icon: IconName
}

const ADDABLE: DockTabItem[] = [
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'browser', label: 'Browser', icon: 'globe' },
  { id: 'changes', label: 'Changes', icon: 'branch' },
  { id: 'pr', label: 'Pull Request', icon: 'pullRequest' },
  { id: 'plan', label: 'Plan', icon: 'listTodo' }
]

/**
 * Cursor-style horizontal tabs above the active right dock panel.
 * Side rail still toggles panels; this bar switches among open types.
 */
export function DockTabBar({
  active,
  tabs,
  onSelect,
  onCloseDock,
  onOpenPanel,
  className
}: {
  active: ChatRightPanelId
  tabs: DockTabItem[]
  onSelect: (id: ChatRightPanelId) => void
  onCloseDock: () => void
  onOpenPanel: (id: ChatRightPanelId) => void
  className?: string
}) {
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)
  const openIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs])
  const addable = ADDABLE.filter((t) => !openIds.has(t.id))

  useEffect(() => {
    if (!addOpen) return undefined
    const onPointerDown = (e: PointerEvent): void => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [addOpen])

  return (
    <div
      className={cn(
        'flex min-w-0 shrink-0 items-center gap-0.5 border-b border-border/40 bg-surface px-1 py-0.5',
        className
      )}
      data-dock-tab-bar
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'inline-flex max-w-[9rem] shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px]',
                selected
                  ? 'bg-bg font-medium text-fg'
                  : 'text-muted hover:bg-bg/50 hover:text-fg'
              )}
              aria-pressed={selected}
              onClick={() => onSelect(tab.id)}
              title={tab.label}
            >
              <Icon name={tab.icon} size={12} className="shrink-0" />
              <span className="min-w-0 truncate">{tab.label}</span>
            </button>
          )
        })}
        {addable.length > 0 ? (
          <div ref={addRef} className="relative shrink-0">
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
                className="absolute left-0 top-full z-dropdown mt-0.5 min-w-[10rem] rounded-md border border-border bg-bg py-1 shadow-lg"
                role="menu"
              >
                {addable.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-fg hover:bg-surface"
                    onClick={() => {
                      setAddOpen(false)
                      onOpenPanel(item.id)
                    }}
                  >
                    <Icon name={item.icon} size={12} />
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <IconButton
        icon="close"
        label="Close panel"
        variant="bare"
        size="sm"
        className="shrink-0 text-muted"
        onClick={onCloseDock}
      />
    </div>
  )
}

export function defaultDockTab(id: ChatRightPanelId, prNumber?: number | null): DockTabItem {
  switch (id) {
    case 'terminal':
      return { id, label: 'Terminal', icon: 'terminal' }
    case 'browser':
      return { id, label: 'Browser', icon: 'globe' }
    case 'changes':
      return { id, label: 'Changes', icon: 'branch' }
    case 'pr':
      return {
        id,
        label: prNumber != null ? `PR #${prNumber}` : 'Pull Request',
        icon: 'pullRequest'
      }
    case 'plan':
      return { id, label: 'Plan', icon: 'listTodo' }
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}
