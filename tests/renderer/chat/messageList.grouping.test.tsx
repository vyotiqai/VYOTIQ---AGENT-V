/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MessageList } from '@renderer/features/chat/components/MessageList'
import type { UiItem } from '@shared/transcript'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  })
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
})

function toolGroup(groupKey: string, summaries: string[]): UiItem[] {
  return summaries.map((summary, i) => ({
    kind: 'tool' as const,
    id: `${groupKey}-${i}`,
    tool: {
      id: `${groupKey}-${i}`,
      name: 'read',
      summary,
      status: 'done' as const
    },
    groupTiming: { startedAt: 1_000, endedAt: 2_000 }
  }))
}

describe('MessageList', () => {
  it('expands and collapses tool groups independently', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u-1', role: 'user', content: 'First task' },
      ...toolGroup('alpha', ['alpha-one.ts', 'alpha-two.ts']),
      { kind: 'message', id: 'u-2', role: 'user', content: 'Second task' },
      ...toolGroup('beta', ['beta-one.ts', 'beta-two.ts'])
    ]

    render(<MessageList items={items} />)

    const toggles = screen.getAllByRole('button', { name: /Read 2 files/i })
    expect(toggles).toHaveLength(2)
    for (const toggle of toggles) {
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
    }
    expect(screen.queryByText('alpha-one.ts')).toBeNull()
    expect(screen.queryByText('beta-one.ts')).toBeNull()

    fireEvent.click(toggles[0])

    expect(toggles[0].getAttribute('aria-expanded')).toBe('true')
    expect(toggles[1].getAttribute('aria-expanded')).toBe('false')
    const alphaGroup = toggles[0].parentElement as HTMLElement
    expect(within(alphaGroup).getByText('alpha-one.ts')).toBeTruthy()
    expect(within(alphaGroup).getByText('alpha-two.ts')).toBeTruthy()
    expect(screen.queryByText('beta-one.ts')).toBeNull()

    fireEvent.click(toggles[0])
    expect(screen.queryByText('alpha-one.ts')).toBeNull()
  })

  it('does not render timestamps in the transcript', () => {
    const items: UiItem[] = [
      {
        kind: 'message',
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        at: '2026-07-24T15:30:00.000Z'
      }
    ]

    render(<MessageList items={items} />)

    expect(screen.queryByRole('time')).toBeNull()
  })
})
