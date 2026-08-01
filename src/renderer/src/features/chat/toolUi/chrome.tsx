import { memo } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { DISCLOSURE_ROW } from '@renderer/lib/utils/layout'
import { TextShimmer } from '../components/TextShimmer'

export const CompactRow = memo(function CompactRow({
  title,
  subtitle,
  status,
  expanded,
  hasBody = true,
  interrupted = false,
  onToggle
}: {
  title: string
  subtitle: string
  status: 'running' | 'done' | 'fail'
  expanded: boolean
  hasBody?: boolean
  interrupted?: boolean
  onToggle: () => void
}) {
  const disclosureLabel = hasBody
    ? `${expanded ? 'Collapse' : 'Expand'} ${title}${subtitle ? `: ${subtitle}` : ''}`
    : title
  return (
    <button
      type="button"
      className={cn(DISCLOSURE_ROW, 'w-full text-left', !hasBody && 'cursor-default')}
      aria-label={disclosureLabel}
      aria-expanded={hasBody ? expanded : undefined}
      disabled={!hasBody}
      onClick={onToggle}
    >
      <span
        className={cn(
          'flex shrink-0 items-center gap-1.5 font-medium tool-status-morph',
          interrupted || status === 'fail' ? 'text-danger' : 'text-fg'
        )}
      >
        {status === 'running' ? <TextShimmer>{title}</TextShimmer> : title}
      </span>
      {subtitle ? (
        <span className="min-w-0 truncate text-tertiary" title={subtitle}>
          {subtitle}
        </span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {interrupted ? <span className="text-danger">interrupted</span> : null}
        {!interrupted && status === 'fail' ? (
          <Icon
            name="warning"
            size={14}
            className="shrink-0 text-danger tool-status-morph"
          />
        ) : null}
        {hasBody ? (
          <Icon
            name="chevronRight"
            size={14}
            className={cn('shrink-0 text-tertiary vy-transition', expanded && 'rotate-90')}
          />
        ) : null}
      </span>
    </button>
  )
})
