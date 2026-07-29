import { cn } from '@renderer/lib/ui/cn'
import type { IncompleteTurnState } from '@renderer/lib/hooks/createChatStreamController'

export function ComposerStatus({
  modelsWarning,
  runNotice,
  incomplete,
  onContinue,
  running,
  className
}: {
  modelsWarning?: string | null
  runNotice?: string | null
  incomplete?: IncompleteTurnState | null
  onContinue?: () => void
  /** When true, show truncation notices without a Continue button (auto-continue in flight). */
  running?: boolean
  className?: string
}) {
  const statusText = runNotice ?? modelsWarning

  // context_overflow is terminal — Continue would just hit the same wall.
  const canContinue = incomplete?.reason !== 'context_overflow'

  if (incomplete && onContinue && !running && canContinue) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <div className="flex items-center justify-end gap-2 px-2.5 text-right text-[11px] leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]">
          <p className="m-0" role="status">
            {incomplete.message}
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="shrink-0 rounded-xl border border-border px-1.5 py-0.5 font-medium text-fg transition-colors hover:bg-surface"
          >
            Continue
          </button>
        </div>
        {statusText ? (
          <p
            className="m-0 px-2.5 text-right text-[11px] leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]"
            role="status"
          >
            {statusText}
          </p>
        ) : null}
      </div>
    )
  }

  if (incomplete && !running && !canContinue) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <p
          className="m-0 px-2.5 text-right text-[11px] leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]"
          role="status"
        >
          {incomplete.message}
        </p>
        {statusText ? (
          <p
            className="m-0 px-2.5 text-right text-[11px] leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]"
            role="status"
          >
            {statusText}
          </p>
        ) : null}
      </div>
    )
  }

  if (incomplete && running) {
    return (
      <p
        className={cn(
          'm-0 px-2.5 text-right text-[11px] leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]',
          className
        )}
        role="status"
      >
        {incomplete.message}
      </p>
    )
  }

  if (!statusText) return null

  return (
    <p
      className={cn(
        'm-0 px-2.5 text-right text-[11px] leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]',
        className
      )}
      role="status"
    >
      {statusText}
    </p>
  )
}
