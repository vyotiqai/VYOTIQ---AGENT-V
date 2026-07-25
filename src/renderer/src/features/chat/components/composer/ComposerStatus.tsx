import { cn } from '@renderer/lib/ui/cn'

export function ComposerStatus({
  modelsWarning,
  runNotice,
  runCacheHint,
  running,
  className
}: {
  modelsWarning?: string | null
  runNotice?: string | null
  runCacheHint?: string | null
  running: boolean
  className?: string
}) {
  if (!modelsWarning && !runNotice && !runCacheHint && !running) return null

  const statusText = runNotice ?? modelsWarning

  return (
    <div className={cn('mt-1.5 flex flex-col items-end gap-1 px-2', className)}>
      {statusText ? (
        <p
          className="m-0 max-w-full text-right text-xs leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]"
          role="status"
        >
          {statusText}
        </p>
      ) : running ? (
        <span
          className="inline-flex items-center text-xs tracking-[var(--vy-tracking)] text-muted"
          role="status"
          aria-label="Working"
        >
          <span
            className="size-2 shrink-0 rounded-full border border-muted bg-surface-2 animate-pulse"
            aria-hidden
          />
        </span>
      ) : null}
      {runCacheHint ? (
        <p
          className="m-0 max-w-full text-right text-xs leading-snug tracking-[var(--vy-tracking)] text-success [overflow-wrap:anywhere]"
          role="status"
        >
          {runCacheHint}
        </p>
      ) : null}
    </div>
  )
}
