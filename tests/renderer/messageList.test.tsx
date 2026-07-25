/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MessageList } from '@renderer/features/chat/MessageList'
import type { UiItem } from '@renderer/shared/hooks/useChatStream'

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
  it('collapses tool groups independently', () => {
    const items: UiItem[] = [
      ...toolGroup('alpha', ['alpha-one.ts', 'alpha-two.ts']),
      { kind: 'message', id: 'msg-1', role: 'assistant', content: 'Done with first batch.' },
      ...toolGroup('beta', ['beta-only.ts'])
    ]

    const { container } = render(
      <MessageList items={items} running={false} runStartedAt={null} />
    )

    const toggles = screen.getAllByRole('button', { name: /Worked for/i })
    expect(toggles).toHaveLength(2)

    expect(screen.getByText(/alpha-one\.ts/)).toBeTruthy()
    expect(screen.getByText(/beta-only\.ts/)).toBeTruthy()

    fireEvent.click(toggles[0])

    expect(screen.getByText('2 tools')).toBeTruthy()
    expect(screen.queryByText(/alpha-one\.ts/)).toBeNull()
    expect(screen.queryByText(/alpha-two\.ts/)).toBeNull()
    expect(screen.getByText(/beta-only\.ts/)).toBeTruthy()

    const betaGroup = container.querySelector('#tool-group-beta-0')
    expect(betaGroup).toBeTruthy()
    expect(within(betaGroup as HTMLElement).getByText(/beta-only\.ts/)).toBeTruthy()
  })

  it('shows timestamps when enabled', () => {
    const items: UiItem[] = [
      {
        kind: 'message',
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        at: '2026-07-24T15:30:00.000Z'
      }
    ]

    render(<MessageList items={items} running={false} runStartedAt={null} showTimestamps />)

    const time = screen.getByRole('time')
    expect(time.getAttribute('datetime')).toBe('2026-07-24T15:30:00.000Z')
    expect(time.textContent?.length).toBeGreaterThan(0)
  })
})
