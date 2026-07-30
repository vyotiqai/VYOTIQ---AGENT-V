import { cn } from '@renderer/lib/ui/cn'
import { fileBadgeForPath } from './mentionModel'

export function FileTypeBadge({
  path,
  className,
  size = 'sm'
}: {
  path: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const badge = fileBadgeForPath(path)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded font-semibold leading-none tracking-tight',
        size === 'sm' ? 'h-4 min-w-4 px-0.5 text-[9px]' : 'h-5 min-w-5 px-1 text-[10px]',
        badge.className,
        className
      )}
      aria-hidden
    >
      {badge.label}
    </span>
  )
}
