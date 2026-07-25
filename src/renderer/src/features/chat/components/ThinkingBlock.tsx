import { useEffect, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { MarkdownContent, cn } from '@renderer/lib/ui'
import { prefersReducedMotion } from '@renderer/lib/utils/motion'

export function ThinkingBlock({
  content,
  streaming,
  expanded,
  onToggle
}: {
  content: string
  streaming?: boolean
  expanded?: boolean
  onToggle?: (next: boolean) => void
}) {
  const [localExpanded, setLocalExpanded] = useState(false)
  const isControlled = expanded != null
  const isExpanded = expanded ?? localExpanded
  const toggle = (): void => {
    const next = !isExpanded
    if (onToggle) onToggle(next)
    else setLocalExpanded(next)
  }
  const reduceMotion = prefersReducedMotion()

  useEffect(() => {
    if (!streaming || isControlled) return
    setLocalExpanded(true)
  }, [streaming, isControlled])

  if (!content && !streaming) return null

  return (
    <div className="mb-2 w-full max-w-[720px]">
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs tracking-[var(--vy-tracking)] text-secondary vy-transition',
          'hover:bg-surface-2 hover:text-fg'
        )}
        aria-expanded={isExpanded}
        onClick={toggle}
      >
        <Icon
          name="chevronRight"
          size={12}
          className={cn(
            'text-tertiary vy-transition',
            isExpanded && 'rotate-90',
            !reduceMotion && 'duration-150'
          )}
        />
        <span className="font-medium text-fg-muted">Thinking</span>
        {streaming ? (
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-secondary" />
        ) : null}
      </button>
      {isExpanded ? (
        <div className="mt-1 rounded-md border border-border bg-surface-1 px-3 py-2 text-xs leading-relaxed text-secondary">
          <MarkdownContent content={content || '…'} streaming={streaming} />
        </div>
      ) : null}
    </div>
  )
}
