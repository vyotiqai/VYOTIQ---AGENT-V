import { memo, useEffect, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { DISCLOSURE_ROW } from '@renderer/lib/utils/layout'
import { formatElapsed } from '@shared/utils/timeFormat'
import type { TurnSpan } from '../utils/transcriptRows'
import { formatRunActivityLabel } from '../utils/runActivity'
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
  const { startedAt, endedAt, active, activity } = span
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
  const phaseLabel = activity ? formatRunActivityLabel(activity) : 'Working'
  // When expanded with a duration, work rows already show verbs — duration only.
  // Before the duration is reportable, keep the phase visible so the header is not blank.
  const activeLabel = collapsed
    ? duration
      ? `${phaseLabel} · ${duration}`
      : phaseLabel
    : duration || phaseLabel
  const doneLabel = duration ? `Worked for ${duration}` : 'Worked'
  const accessibleName = active
    ? collapsed
      ? activeLabel || phaseLabel
      : activeLabel
        ? `Collapse turn work, ${activeLabel}`
        : 'Collapse turn work'
    : doneLabel

  return (
    <button
      type="button"
      className={cn(DISCLOSURE_ROW, 'w-full text-left text-tertiary')}
      aria-expanded={!collapsed}
      aria-controls={!collapsed ? panelId : undefined}
      aria-label={accessibleName}
      onClick={onToggle}
    >
      {active ? (
        activeLabel ? (
          <TextShimmer className="shrink-0">{activeLabel}</TextShimmer>
        ) : (
          <span className="shrink-0 tabular-nums opacity-0" aria-hidden>
            ·
          </span>
        )
      ) : (
        <span className="shrink-0 tabular-nums">{doneLabel}</span>
      )}
      <Icon
        name="chevronRight"
        size={14}
        className={cn('shrink-0 self-center vy-transition', !collapsed && 'rotate-90')}
      />
    </button>
  )
})
