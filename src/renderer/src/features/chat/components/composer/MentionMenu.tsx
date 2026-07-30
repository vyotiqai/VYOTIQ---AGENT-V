import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { FileTypeIcon } from '@renderer/lib/fileIcons'
import { Icon, type IconName } from '@renderer/lib/icons'
import { useDropdownMenu } from '@renderer/lib/hooks/useDropdownMenu'
import { cn } from '@renderer/lib/ui/cn'
import { FileTypeBadge } from './FileTypeBadge'
import {
  pathSegments,
  type MentionMenuItem,
  type MentionMenuView
} from './mentionModel'

function itemIcon(item: MentionMenuItem): IconName {
  switch (item.kind) {
    case 'branch':
      return 'branch'
    case 'browser':
      return 'globe'
    case 'lints':
      return 'warning'
    case 'nav':
      if (item.view === 'files') return 'folder'
      if (item.view === 'docs') return 'doc'
      if (item.view === 'rules') return 'listTodo'
      return 'doc'
    case 'file':
    case 'docs':
      return 'file'
    case 'rule':
      return 'listTodo'
    case 'chat':
      return 'doc'
    case 'show-more':
      return 'chevron'
    default: {
      const _exhaustive: never = item
      return _exhaustive
    }
  }
}

function PathTree({ path }: { path: string }) {
  const parts = pathSegments(path)
  if (!parts.length) return null
  return (
    <div className="flex min-w-[140px] max-w-[180px] flex-col gap-0.5 border-l border-border px-2 py-1.5">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1
        return (
          <div
            key={`${i}:${part}`}
            className="flex items-center gap-1.5 text-[11px] text-muted"
            style={{ paddingLeft: i * 8 }}
          >
            {isLast ? (
              <FileTypeBadge path={path} />
            ) : (
              <FileTypeIcon path={part} kind="folder" size={14} />
            )}
            <span className={cn('truncate', isLast && 'font-medium text-fg')}>{part}</span>
          </div>
        )
      })}
    </div>
  )
}

function rootSectionLabel(item: MentionMenuItem, index: number, items: MentionMenuItem[]): string | null {
  if (index === 0) return 'Suggested'
  const prev = items[index - 1]
  if (!prev) return null
  const isFileish = item.kind === 'file'
  const prevFileish = prev.kind === 'file'
  if (isFileish && !prevFileish) return 'Files'
  const isNav = item.kind === 'nav' || item.kind === 'lints'
  const prevNav = prev.kind === 'nav' || prev.kind === 'lints' || prev.kind === 'branch' || prev.kind === 'browser'
  if (isNav && prevFileish) return 'More'
  if (item.kind === 'nav' && prev.kind !== 'nav' && !prevFileish && index > 0 && !prevNav) {
    return null
  }
  return null
}

export function MentionMenu({
  open,
  view,
  items,
  activeIndex,
  onActiveIndexChange,
  onPick,
  onDismiss,
  onBack,
  anchorRef,
  loading,
  listId = 'composer-mention-menu'
}: {
  open: boolean
  view: MentionMenuView
  items: MentionMenuItem[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onPick: (item: MentionMenuItem) => void
  onDismiss?: () => void
  onBack?: () => boolean
  anchorRef: RefObject<HTMLElement | null>
  loading?: boolean
  listId?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLElement | null>>([])

  const { position } = useDropdownMenu({
    open,
    onOpenChange: (next) => {
      if (!next) {
        // Escape / outside: prefer subview back over full dismiss.
        if (view !== 'root' && onBack?.()) return
        onDismiss?.()
      }
    },
    triggerRef: anchorRef,
    panelRef,
    placement: 'up',
    align: 'start',
    disabled: !open
  })

  useEffect(() => {
    if (!open || activeIndex < 0) return
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  if (!open || !position) return null

  const active = items[activeIndex] ?? null
  const activePath =
    active?.kind === 'file' || active?.kind === 'docs' || active?.kind === 'rule'
      ? active.path
      : null
  const showTree =
    (view === 'files' || view === 'docs' || view === 'rules') && Boolean(activePath)
  const title =
    view === 'files'
      ? 'Files & Folders'
      : view === 'chats'
        ? 'Past Chats'
        : view === 'docs'
          ? 'Docs'
          : view === 'rules'
            ? 'Rules'
            : null

  const activeDescendant =
    activeIndex >= 0 && items[activeIndex]
      ? `${listId}-opt-${items[activeIndex]!.id}`
      : undefined

  return createPortal(
    <div
      ref={panelRef}
      id={listId}
      role="listbox"
      aria-label="Mentions"
      aria-activedescendant={activeDescendant}
      className={cn(
        'fixed z-dropdown flex max-h-80 overflow-hidden rounded-md border border-border bg-card shadow-menu animate-fade-in',
        showTree ? 'w-[min(92vw,480px)]' : 'w-[min(92vw,320px)]'
      )}
      style={{
        top: position.placement === 'up' ? undefined : position.top,
        bottom:
          position.placement === 'up' ? window.innerHeight - position.top : undefined,
        left: position.left,
        minWidth: Math.max(position.minWidth, 260)
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {title ? (
          <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
            {onBack ? (
              <button
                type="button"
                className="rounded p-0.5 text-muted hover:bg-surface hover:text-fg"
                aria-label="Back"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onBack()}
              >
                <Icon name="chevron" size={14} className="rotate-90" />
              </button>
            ) : null}
            <span className="text-xs font-medium text-fg">{title}</span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {loading && items.length === 0 ? (
            <p className="m-0 px-2.5 py-2 text-xs text-muted">Searching…</p>
          ) : items.length === 0 ? (
            <p className="m-0 px-2.5 py-2 text-xs text-muted">No matches</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {items.map((item, index) => {
                const selected = index === activeIndex
                const optionId = `${listId}-opt-${item.id}`
                const section =
                  view === 'root' ? rootSectionLabel(item, index, items) : null
                return (
                  <li key={item.id} className="m-0">
                    {section ? (
                      <p className="m-0 px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {section}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      id={optionId}
                      role="option"
                      aria-selected={selected}
                      ref={(el) => {
                        optionRefs.current[index] = el
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                        selected ? 'bg-surface-2 text-fg' : 'text-fg hover:bg-surface'
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => onActiveIndexChange(index)}
                      onClick={() => onPick(item)}
                    >
                      {item.kind === 'file' || item.kind === 'docs' ? (
                        <FileTypeBadge path={item.path} />
                      ) : (
                        <Icon
                          name={itemIcon(item)}
                          size={16}
                          className="shrink-0 text-muted"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium leading-snug">
                          {item.label}
                        </span>
                        {'subtitle' in item && item.subtitle ? (
                          <span className="block truncate text-[11px] text-muted">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {item.kind === 'nav' || item.kind === 'show-more' ? (
                        <Icon name="chevronRight" size={14} className="shrink-0 text-muted" />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
      {showTree && activePath ? <PathTree path={activePath} /> : null}
    </div>,
    document.body
  )
}
