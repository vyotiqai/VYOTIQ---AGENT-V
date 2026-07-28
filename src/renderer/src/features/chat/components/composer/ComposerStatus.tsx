import { cn } from '@renderer/lib/ui/cn'
import type { IncompleteTurnState } from '@renderer/lib/hooks/createChatStreamController'

export function ComposerStatus({
  modelsWarning,
  runNotice,
  incomplete,
  onContinue,
  className
}: {
  modelsWarning?: string | null
  runNotice?: string | null
  incomplete?: IncompleteTurnState | null
  onContinue?: () => void
  className?: string
}) {
  const statusText = runNotice ?? modelsWarning

  if (incomplete && onContinue) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <p
          className="m-0 flex items-center justify-end gap-2 px-2.5 text-right text-[11px] leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]"
          role="status"
        >
          <span>{incomplete.message}</span>
          <button
            type="button"
            onClick={onContinue}
            className="shrink-0 rounded-xl border border-border px-1.5 py-0.5 font-medium text-fg transition-colors hover:bg-surface"
          >
            Continue
          </button>
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
