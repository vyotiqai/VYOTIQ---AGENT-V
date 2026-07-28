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
  it('shows phase label with shimmer while active', () => {
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

    expect(screen.getByRole('button', { name: /Collapse turn work, 3s/i })).toBeTruthy()
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

  it('shows phase label when expanded before duration is reportable', () => {
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

    expect(screen.getByRole('button', { name: /Collapse turn work, Thinking/i })).toBeTruthy()
  })

  it('keeps awaiting approval visible when expanded without duration', () => {
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

    expect(screen.getByRole('button', { name: /Awaiting approval/i })).toBeTruthy()
  })
})
