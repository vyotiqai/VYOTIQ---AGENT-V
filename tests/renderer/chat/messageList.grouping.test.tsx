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
      ...toolGroup('alpha', ['alpha-one.ts', 'alpha-two.ts']),
      { kind: 'message', id: 'msg-1', role: 'assistant', content: 'Done with first batch.' },
      ...toolGroup('beta', ['beta-one.ts', 'beta-two.ts'])
    ]

    render(<MessageList items={items} />)

    const toggles = screen.getAllByRole('button', { name: /Explored 2 files/i })
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

  it('renders a message timestamp from its persisted time', () => {
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

    const time = screen.getByRole('time')
    expect(time.getAttribute('datetime')).toBe('2026-07-24T15:30:00.000Z')
    expect(time.textContent?.length).toBeGreaterThan(0)
  })
})
