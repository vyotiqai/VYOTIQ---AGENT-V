import { memo } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import {
  TOOL_CARD_BODY,
  TOOL_CARD_HEADER,
  TOOL_CARD_SURFACE,
  TOOL_BODY_CLAMP_PX
} from '@renderer/lib/utils/layout'
import { DISCLOSURE_ROW } from '@renderer/lib/utils/layout'
import { TextShimmer } from '../components/TextShimmer'

export function ProminentChrome({
  header,
  body,
  expanded,
  hasBody,
  running,
  clampWhenCollapsed = true,
  onToggle
}: {
  header: React.ReactNode
  body: React.ReactNode
  expanded: boolean
  hasBody: boolean
  running: boolean
  /** When false, the collapsed preview is not height-clamped (e.g. task checklists). */
  clampWhenCollapsed?: boolean
  onToggle: () => void
}) {
  return (
    <div className={cn(TOOL_CARD_SURFACE, 'w-full')}>
      <button
        type="button"
        className={cn(
          TOOL_CARD_HEADER,
          'flex w-full items-center gap-2 text-left vy-transition',
          hasBody && 'hover:bg-surface/60'
        )}
        onClick={onToggle}
        aria-expanded={expanded}
        disabled={!hasBody}
      >
        {header}
        {hasBody ? (
          <Icon
            name="chevronRight"
            size={12}
            className={cn('ml-auto shrink-0 text-tertiary vy-transition', expanded && 'rotate-90')}
          />
        ) : null}
      </button>
      {hasBody && body ? (
        <div
          className={cn(TOOL_CARD_BODY, !expanded && clampWhenCollapsed && 'mask-fade-bottom')}
          style={
            !expanded && clampWhenCollapsed ? { maxHeight: TOOL_BODY_CLAMP_PX } : undefined
          }
        >
          {body}
        </div>
      ) : null}
      {!hasBody && running ? (
        <div className="border-t border-border bg-surface px-3 py-2 text-[11px] text-tertiary">
          <TextShimmer>Working…</TextShimmer>
        </div>
      ) : null}
    </div>
  )
}

export const CompactRow = memo(function CompactRow({
  title,
  subtitle,
  status,
  expanded,
  onToggle
}: {
  title: string
  subtitle: string
  status: 'running' | 'done' | 'fail'
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={cn(DISCLOSURE_ROW, 'w-full text-left')}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className={cn('shrink-0 font-medium', status === 'fail' ? 'text-danger' : 'text-fg')}>
        {status === 'running' ? <TextShimmer>{title}</TextShimmer> : title}
      </span>
      {subtitle ? (
        <span className="min-w-0 truncate text-tertiary" title={subtitle}>
          {subtitle}
        </span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {status === 'fail' ? (
          <Icon name="warning" size={11} className="shrink-0 text-danger" />
        ) : null}
        <Icon
          name="chevronRight"
          size={11}
          className={cn('text-tertiary vy-transition', expanded && 'rotate-90')}
        />
      </span>
    </button>
  )
})
