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
      <p
        className={cn(
          'm-0 flex items-center justify-end gap-2 px-2.5 text-right text-[11px] leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]',
          className
        )}
        role="status"
      >
        <span>{incomplete.message}</span>
        <button
          type="button"
          onClick={onContinue}
          className="shrink-0 rounded-md border border-subtle px-1.5 py-0.5 font-medium text-fg transition-colors hover:bg-hover"
        >
          Continue
        </button>
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
