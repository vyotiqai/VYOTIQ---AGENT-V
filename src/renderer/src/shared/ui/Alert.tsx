import { type ReactNode } from 'react'
import { IconButton } from './IconButton'
import { cn } from './cn'

export function Alert({
  children,
  variant = 'danger',
  onDismiss,
  dismissLabel = 'Dismiss',
  className = ''
}: {
  children: ReactNode
  variant?: 'danger'
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm [overflow-wrap:anywhere]',
        variant === 'danger' && 'border-danger/25 bg-surface text-danger',
        className
      )}
      role="alert"
    >
      <div className="m-0 min-w-0 flex-1">{children}</div>
      {onDismiss ? (
        <IconButton
          icon="close"
          label={dismissLabel}
          size="sm"
          className="shrink-0 text-danger hover:bg-surface-2"
          onClick={onDismiss}
        />
      ) : null}
    </div>
  )
}

/** Persistent inline alert without dismiss — e.g. settings errors. */
export function AlertBlock({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        'm-0 rounded-md border border-danger/25 bg-surface px-2.5 py-2 text-xs text-danger [overflow-wrap:anywhere]',
        className
      )}
      role="alert"
    >
      {children}
    </p>
  )
}
