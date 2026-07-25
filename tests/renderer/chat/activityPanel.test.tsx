/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ActivityPanel } from '@renderer/features/chat/components/ActivityPanel'

afterEach(() => {
  cleanup()
})

describe('ActivityPanel', () => {
  it('renders collapsed with row count and expands on click', () => {
    render(
      <ActivityPanel
        rows={[
          {
            at: '2026-07-24T12:00:00.000Z',
            event: { type: 'status', runId: 'r1', status: 'running' }
          },
          {
            at: '2026-07-24T12:00:05.000Z',
            event: { type: 'status', runId: 'r1', status: 'done' }
          }
        ]}
      />
    )
    const toggle = screen.getByRole('button', { name: /activity/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.queryByText('Run started')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Run started')).toBeTruthy()
    expect(screen.getByText('Run finished')).toBeTruthy()
  })

  it('renders nothing when there are no rows', () => {
    const { container } = render(<ActivityPanel rows={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
