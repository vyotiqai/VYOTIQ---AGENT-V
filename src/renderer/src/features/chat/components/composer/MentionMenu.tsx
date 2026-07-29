import { useEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useDropdownMenu } from '@renderer/lib/hooks/useDropdownMenu'
import { cn } from '@renderer/lib/ui/cn'

export function MentionMenu({
  open,
  paths,
  activeIndex,
  onActiveIndexChange,
  onPick,
  onDismiss,
  anchorRef,
  loading,
  listId = 'composer-mention-menu'
}: {
  open: boolean
  paths: string[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onPick: (path: string) => void
  onDismiss?: () => void
  anchorRef: RefObject<HTMLElement | null>
  loading?: boolean
  listId?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLElement | null>>([])

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

  useEffect(() => {
    if (!open || activeIndex < 0) return
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  if (!open || !position) return null

  return createPortal(
    <div
      ref={panelRef}
      id={listId}
      role="listbox"
      aria-label="File mentions"
      className="z-[80] max-h-56 w-[min(90vw,360px)] overflow-auto rounded-md border border-border bg-bg shadow-lg"
      style={{ position: 'fixed', top: position.top, left: position.left }}
    >
      {loading && paths.length === 0 ? (
        <p className="m-0 px-2.5 py-2 text-xs text-muted">Searching…</p>
      ) : paths.length === 0 ? (
        <p className="m-0 px-2.5 py-2 text-xs text-muted">No matching files</p>
      ) : (
        <ul className="m-0 list-none p-1">
          {paths.map((path, index) => {
            const active = index === activeIndex
            return (
              <li key={path} className="m-0">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  ref={(el) => {
                    optionRefs.current[index] = el
                  }}
                  className={cn(
                    'flex w-full rounded px-2 py-1.5 text-left text-xs text-fg',
                    active ? 'bg-surface' : 'hover:bg-surface/70'
                  )}
                  onMouseEnter={() => onActiveIndexChange(index)}
                  onClick={() => onPick(path)}
                >
                  <span className="truncate font-mono">@{path}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>,
    document.body
  )
}
