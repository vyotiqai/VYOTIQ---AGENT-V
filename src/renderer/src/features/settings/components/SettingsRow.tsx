import type { ReactNode } from 'react'

export function SettingsRow({
  title,
  description,
  children,
  stacked
}: {
  title: string
  description?: string
  children: ReactNode
  stacked?: boolean
}) {
  if (stacked) {
    return (
      <div className="border-b border-border px-0 py-3">
        <p className="m-0 text-sm tracking-[var(--vy-tracking)] text-fg-strong">{title}</p>
        {description ? (
          <p className="m-0 mt-0.5 text-xs leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]">
            {description}
          </p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">{children}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-stretch gap-2.5 border-b border-border px-0 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm tracking-[var(--vy-tracking)] text-fg-strong">{title}</p>
        {description ? (
          <p className="m-0 mt-0.5 text-xs leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{children}</div>
    </div>
  )
}
