/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TurnSummary } from '@renderer/features/chat/components/TurnSummary'
import type { TurnSpan } from '@renderer/features/chat/utils/transcriptRows'

afterEach(() => {
  cleanup()
})

describe('TurnSummary', () => {
  it('shows turn Work label when expanded and active (phase shown on tools)', () => {
    render(
      <TurnSummary
        span={{
          startedAt: Date.now() - 3_000,
          endedAt: null,
          active: true,
          activity: { kind: 'thinking' }
        }}
        collapsed={false}
        onToggle={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /Collapse turn work, Work · 3s/i })).toBeTruthy()
    expect(document.querySelector('.vy-text-shimmer--active')).toBeTruthy()
  })

  it('shows phase label when collapsed and active', () => {
    render(
      <TurnSummary
        span={{
          startedAt: Date.now() - 3_000,
          endedAt: null,
          active: true,
          activity: { kind: 'thinking' }
        }}
        collapsed={true}
        onToggle={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /Thinking · 3s/i })).toBeTruthy()
  })

  it('uses phaseStartedAt for collapsed tool-phase duration', () => {
    const turnStart = Date.now() - 250_000
    const phaseStart = Date.now() - 4_000
    render(
      <TurnSummary
        span={{
          startedAt: turnStart,
          endedAt: null,
          active: true,
          activity: { kind: 'tool', label: 'Editing', detail: 'file' },
          phaseStartedAt: phaseStart
        }}
        collapsed={true}
        onToggle={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /Editing file · 4s/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /4m/i })).toBeNull()
  })

  it('shows worked label without shimmer when finished', () => {
    const startedAt = Date.parse('2026-07-25T10:00:00.000Z')
    const endedAt = Date.parse('2026-07-25T10:00:09.000Z')
    render(
      <TurnSummary
        span={{
          startedAt,
          endedAt,
          active: false,
          activity: null
        }}
        collapsed={false}
        onToggle={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /Worked for 9s/i })).toBeTruthy()
    expect(document.querySelector('.vy-text-shimmer--active')).toBeNull()
  })

  it('shows planning when activity is planning', () => {
    render(
      <TurnSummary
        span={{
          startedAt: Date.now(),
          endedAt: null,
          active: true,
          activity: { kind: 'planning' }
        }}
        collapsed={true}
        onToggle={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /Planning/i })).toBeTruthy()
  })

  it('shows Work when expanded before duration is reportable', () => {
    render(
      <TurnSummary
        span={{
          startedAt: Date.now(),
          endedAt: null,
          active: true,
          activity: { kind: 'thinking' }
        }}
        collapsed={false}
        onToggle={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /Collapse turn work, Work$/i })).toBeTruthy()
  })

  it('keeps Work collapse control when expanded during approval', () => {
    render(
      <TurnSummary
        span={{
          startedAt: Date.now(),
          endedAt: null,
          active: true,
          activity: { kind: 'awaiting_approval' }
        }}
        collapsed={false}
        onToggle={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /Collapse turn work, Work$/i })).toBeTruthy()
  })
})
