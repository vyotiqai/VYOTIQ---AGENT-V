import { memo, useEffect, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { DISCLOSURE_ROW } from '@renderer/lib/utils/layout'
import { formatElapsed } from '@shared/utils/timeFormat'
import type { TurnSpan } from '../utils/transcriptRows'
import { TextShimmer } from './TextShimmer'

/** Below this the duration is noise; the turn was effectively instant. */
const MIN_REPORTABLE_MS = 1000

export const TurnSummary = memo(function TurnSummary({
  span,
  collapsed,
  panelId,
  onToggle
}: {
  span: TurnSpan
  collapsed: boolean
  panelId?: string
  onToggle: () => void
}) {
  const { startedAt, endedAt, active } = span
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active || startedAt == null) return undefined
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [active, startedAt])

  const elapsedMs =
    startedAt == null ? null : active ? now - startedAt : endedAt == null ? null : endedAt - startedAt

  const duration = elapsedMs != null && elapsedMs >= MIN_REPORTABLE_MS ? formatElapsed(elapsedMs) : ''
  const label = active
    ? duration
      ? `Working for ${duration}`
      : 'Working'
    : duration
      ? `Worked for ${duration}`
      : 'Worked'

  return (
    <button
      type="button"
      className={cn(DISCLOSURE_ROW, 'text-tertiary')}
      aria-expanded={!collapsed}
      aria-controls={!collapsed ? panelId : undefined}
      onClick={onToggle}
    >
      {active ? (
        <TextShimmer className="shrink-0">{label}</TextShimmer>
      ) : (
        <span className="shrink-0 tabular-nums">{label}</span>
      )}
      <Icon
        name="chevronRight"
        size={12}
        className={cn('self-center vy-transition', !collapsed && 'rotate-90')}
      />
    </button>
  )
})
