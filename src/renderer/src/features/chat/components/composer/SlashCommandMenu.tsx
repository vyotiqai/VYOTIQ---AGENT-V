import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { SlashCommandDescriptor } from '@shared/ipc'
import { useDropdownMenu } from '@renderer/lib/hooks/useDropdownMenu'
import { cn } from '@renderer/lib/ui/cn'
import {
  clampComposerDropdownPanel,
  composerDropdownRow,
  composerDropdownSectionHeader
} from './composerDropdownLayout'
import { availabilityCtaLabel } from './slashCommandExecute'

const SLASH_MAX_PX = 360

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

  const showGroupHeaders = sections.length > 1

  useEffect(() => {
    if (!open || activeIndex < 0) return
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  if (!open || !position) return null

  const { left, width, maxHeight } = clampComposerDropdownPanel({
    position,
    maxWidthPx: SLASH_MAX_PX
  })

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
      className="fixed z-dropdown flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-menu animate-fade-in"
      style={{
        top: position.placement === 'up' ? undefined : position.top,
        bottom:
          position.placement === 'up' ? window.innerHeight - position.top : undefined,
        left,
        width,
        maxWidth: width,
        maxHeight
      }}
      role="listbox"
      id={listId}
      aria-label="Slash commands"
      aria-activedescendant={activeDescendant}
    >
      <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto p-1">
        {loading && commands.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-secondary">Loading commands…</div>
        ) : null}
        {listError && commands.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-danger" role="alert">
            {listError}
          </div>
        ) : null}
        {!loading && !listError && commands.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-secondary">No matches</div>
        ) : null}
        {loading && commands.length > 0 ? (
          <div className="px-2.5 py-1 text-[10px] text-secondary">Refreshing…</div>
        ) : null}
        {sections.map(({ group, items, startIndex }) => (
          <div
            key={`${group}:${startIndex}`}
            className="mb-1"
            role="group"
            aria-label={group}
          >
            {showGroupHeaders ? (
              <div className={composerDropdownSectionHeader}>{group}</div>
            ) : null}
            <ul className="m-0 list-none p-0">
              {items.map((cmd, offset) => {
                const index = startIndex + offset
                const selected = index === activeIndex
                const cta = availabilityCtaLabel(cmd.availability)
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
                      className={cn(composerDropdownRow, selected && 'bg-surface-2 text-fg')}
                      onMouseEnter={() => {
                        onActiveIndexChange(index)
                        setHoveredId(cmd.id)
                      }}
                      onMouseLeave={() => setHoveredId(null)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPick(cmd)}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate font-medium leading-snug"
                          title={`/${cmd.trigger}`}
                        >
                          /{cmd.trigger}
                        </span>
                        {cmd.label ? (
                          <span
                            className="block truncate text-[11px] text-secondary"
                            title={cmd.label}
                          >
                            {cmd.label}
                          </span>
                        ) : null}
                      </span>
                      {cta ? (
                        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-secondary">
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
        <div className="shrink-0 border-t border-border px-2.5 py-1.5 text-xs leading-snug text-secondary">
          {tooltipCmd.description}
        </div>
      ) : null}
    </div>,
    document.body
  )
}
