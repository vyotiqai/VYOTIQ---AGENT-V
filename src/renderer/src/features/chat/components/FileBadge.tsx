import { memo } from 'react'
import { cn } from '@renderer/lib/ui'
import { fileBadgeInfo } from '../toolUi'

/**
 * The file's type as a short mark, sitting where a file icon normally would.
 *
 * Text rather than an icon set: `TS` / `{}` / `$` / `M↓` match screenshot chrome.
 */
export const FileBadge = memo(function FileBadge({
  path,
  className
}: {
  path: string
  className?: string
}) {
  const badge = fileBadgeInfo(path)
  if (!badge) return null

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm border border-border',
        'px-1 py-px font-mono text-[9px] leading-none uppercase text-tertiary',
        badge.className,
        className
      )}
    >
      {badge.label}
    </span>
  )
})
