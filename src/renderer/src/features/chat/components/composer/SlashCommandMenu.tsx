import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { SlashCommandDescriptor } from '@shared/ipc'
import { useDropdownMenu } from '@renderer/lib/hooks/useDropdownMenu'
import { cn } from '@renderer/lib/ui/cn'
import { availabilityCtaLabel } from './slashCommandExecute'

export function SlashCommandMenu({
  open,
  commands,
  activeIndex,
  onActiveIndexChange,
  onPick,
  onDismiss,
  anchorRef,
  listId = 'slash-command-menu',
  loading,
  listError
}: {
  open: boolean
  commands: SlashCommandDescriptor[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onPick: (command: SlashCommandDescriptor) => void
  onDismiss?: () => void
  anchorRef: RefObject<HTMLElement | null>
  listId?: string
  loading?: boolean
  listError?: string | null
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLElement | null>>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const { position } = useDropdownMenu({
    open,
    onOpenChange: (next) => {
      if (!next) onDismiss?.()
    },
    triggerRef: anchorRef,
    panelRef,
    placement: 'up',
    align: 'start',
    disabled: !open
  })

  // commands is already GROUP_ORDER-flattened; insert headers without reordering.
  const sections = useMemo(() => {
    const out: Array<{ group: string; items: SlashCommandDescriptor[]; startIndex: number }> = []
    let i = 0
    while (i < commands.length) {
      const group = commands[i]!.group
      const startIndex = i
      const items: SlashCommandDescriptor[] = []
      while (i < commands.length && commands[i]!.group === group) {
        items.push(commands[i]!)
        i += 1
      }
      out.push({ group, items, startIndex })
    }
    return out
  }, [commands])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    const el = optionRefs.current[activeIndex]
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  if (!open || !position) return null

  const hovered = hoveredId ? commands.find((c) => c.id === hoveredId) : null
  const active = commands[activeIndex] ?? null
  const tooltipCmd = hovered ?? active
  const activeDescendant =
    activeIndex >= 0 && commands[activeIndex]
      ? `${listId}-opt-${commands[activeIndex]!.id}`
      : undefined

  return createPortal(
    <div
      ref={panelRef}
      className={cn(
        'fixed z-dropdown flex max-h-72 w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden rounded-md border border-border bg-card shadow-menu animate-fade-in'
      )}
      style={{
        top: position.placement === 'up' ? undefined : position.top,
        bottom:
          position.placement === 'up' ? window.innerHeight - position.top : undefined,
        left: position.left,
        minWidth: Math.max(position.minWidth, 280)
      }}
      role="listbox"
      id={listId}
      aria-label="Slash commands"
      aria-activedescendant={activeDescendant}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {loading && commands.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-muted">Loading commands…</div>
        ) : null}
        {listError && commands.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-danger">{listError}</div>
        ) : null}
        {!loading && !listError && commands.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-muted">No matches</div>
        ) : null}
        {sections.map(({ group, items, startIndex }) => (
          <div key={`${group}:${startIndex}`} className="mb-1">
            <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted">
              {group}
            </div>
            <ul className="m-0 list-none p-0">
              {items.map((cmd, offset) => {
                const index = startIndex + offset
                const selected = index === activeIndex
                const cta = availabilityCtaLabel(cmd.availability)
                const muted = cmd.availability !== 'ready'
                const optionId = `${listId}-opt-${cmd.id}`
                return (
                  <li key={cmd.id} role="presentation">
                    <button
                      type="button"
                      id={optionId}
                      role="option"
                      aria-selected={selected}
                      ref={(el) => {
                        optionRefs.current[index] = el
                      }}
                      title={cmd.description || undefined}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                        selected ? 'bg-surface-2 text-fg' : 'text-fg hover:bg-surface',
                        muted && 'opacity-70'
                      )}
                      onMouseEnter={() => {
                        onActiveIndexChange(index)
                        setHoveredId(cmd.id)
                      }}
                      onMouseLeave={() => setHoveredId(null)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPick(cmd)}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">/{cmd.trigger}</span>
                      <span className="hidden max-w-[140px] truncate text-xs text-muted sm:inline">
                        {cmd.label}
                      </span>
                      {cta ? (
                        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                          {cta}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {tooltipCmd?.description ? (
        <div className="border-t border-border px-2.5 py-1.5 text-xs leading-snug text-muted">
          {tooltipCmd.description}
        </div>
      ) : null}
    </div>,
    document.body
  )
}
