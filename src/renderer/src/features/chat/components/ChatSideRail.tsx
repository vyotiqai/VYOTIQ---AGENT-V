import { IconButton, cn } from '@renderer/lib/ui'

/**
 * In-layout right rail for toggling chat secondary panels.
 * Kept non-overlay to avoid layout/position inconsistencies.
 */
export function ChatSideRail({
  browserOpen,
  browserActive,
  onToggleBrowser,
  className
}: {
  browserOpen: boolean
  /** True when the agent browser has a live page (even if panel closed). */
  browserActive?: boolean
  onToggleBrowser: () => void
  className?: string
}) {
  return (
    <aside
      className={cn(
        'flex h-full w-10 shrink-0 flex-col items-center justify-start pt-2',
        className
      )}
      data-chat-side-rail
      aria-label="Panels"
    >
      <div className="relative">
        <IconButton
          icon="globe"
          label={browserOpen ? 'Hide browser panel' : 'Show browser panel'}
          variant="bare"
          size="sm"
          aria-pressed={browserOpen}
          className={cn(
            'text-muted hover:text-fg',
            browserOpen && 'text-fg',
            browserActive && !browserOpen && 'text-accent'
          )}
          onClick={onToggleBrowser}
        />
        {browserActive && !browserOpen ? (
          <span
            className="pointer-events-none absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent"
            aria-hidden
          />
        ) : null}
      </div>
    </aside>
  )
}
