import { memo, useEffect, useMemo, useState } from 'react'
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
  onToggle
}: {
  span: TurnSpan
  collapsed: boolean
  onToggle: () => void
}) {
  const { startedAt, endedAt, active, activity, phaseStartedAt } = span
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active || startedAt == null) return undefined
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [active, startedAt])

  const turnElapsedMs =
    startedAt == null ? null : active ? now - startedAt : endedAt == null ? null : endedAt - startedAt

  const phaseAnchor = phaseStartedAt ?? startedAt
  const phaseElapsedMs =
    phaseAnchor == null
      ? null
      : active
        ? now - phaseAnchor
        : endedAt == null
          ? null
          : endedAt - phaseAnchor

  const turnDuration = useMemo(
    () =>
      turnElapsedMs != null && turnElapsedMs >= MIN_REPORTABLE_MS ? formatElapsed(turnElapsedMs) : '',
    [turnElapsedMs]
  )
  const phaseDuration = useMemo(
    () =>
      phaseElapsedMs != null && phaseElapsedMs >= MIN_REPORTABLE_MS ? formatElapsed(phaseElapsedMs) : '',
    [phaseElapsedMs]
  )

  const phaseLabel = activity ? formatRunActivityLabel(activity) : 'Working'

  // Expanded + active: tools already show the phase — only turn duration here.
  // Collapsed + active: full phase label; tool phases use phaseStartedAt duration.
  let activeLabel: string
  if (!collapsed) {
    activeLabel = turnDuration ? `Work · ${turnDuration}` : 'Work'
  } else if (activity?.kind === 'tool') {
    activeLabel = phaseDuration ? `${phaseLabel} · ${phaseDuration}` : phaseLabel
  } else {
    activeLabel = turnDuration ? `${phaseLabel} · ${turnDuration}` : phaseLabel
  }

  const doneLabel = turnDuration ? `Worked for ${turnDuration}` : 'Worked'
  const accessibleName = active
    ? collapsed
      ? activeLabel
      : `Collapse turn work, ${activeLabel}`
    : doneLabel

  return (
    <button
      type="button"
      className={cn(DISCLOSURE_ROW, 'w-full text-left text-tertiary')}
      aria-expanded={!collapsed}
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
