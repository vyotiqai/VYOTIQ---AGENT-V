import { memo } from 'react'
import { cn } from '@renderer/lib/ui'
import { fileBadge } from '../toolUi'

/**
 * The file's type as a short mark, sitting where a file icon normally would.
 *
 * Text rather than an icon set: `ts` reads unambiguously at 9px, stays legible
 * in both themes, and does not need a glyph per language.
 */
export const FileBadge = memo(function FileBadge({
  path,
  className
}: {
  path: string
  className?: string
}) {
  const badge = fileBadge(path)
  if (!badge) return null

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm border border-border',
        'px-1 py-px font-mono text-[9px] leading-none uppercase text-tertiary',
        className
      )}
    >
      {badge}
    </span>
  )
})
