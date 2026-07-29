/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

function subagentItem(overrides: Partial<Extract<UiItem, { kind: 'tool' }>> = {}): UiItem {
  return {
    kind: 'tool',
    id: 'call-1',
    tool: {
      id: 'call-1',
      name: 'subagent',
      summary: 'Find where auth lives',
      status: 'running'
    },
    subagent: [
      { kind: 'tool', text: 'grep session' },
      { kind: 'tool', text: 'read src/auth.ts' }
    ],
    ...overrides
  }
}

describe('sub-agent transcript row', () => {
  it('shows nested progress while the child is still working', () => {
    render(<MessageList items={[subagentItem()]} />)

    expect(screen.getByText('Investigating')).toBeTruthy()
    expect(screen.getByText('Find where auth lives')).toBeTruthy()
    expect(screen.getByText(/grep session/)).toBeTruthy()
    expect(screen.getByText(/read src\/auth\.ts/)).toBeTruthy()
  })

  it('shows the report once the child is done', () => {
    const item = subagentItem({
      tool: {
        id: 'call-1',
        name: 'subagent',
        summary: 'Find where auth lives',
        status: 'done',
        content: 'Auth lives in src/auth.ts:12.'
      }
    })
    render(<MessageList items={[item]} />)

    expect(screen.getByText('Investigated')).toBeTruthy()
    // Completed tool bodies stay collapsed by default — expand then assert.
    const header = screen.getByRole('button', { expanded: false })
    fireEvent.click(header)
    expect(screen.getByText('Auth lives in src/auth.ts:12.')).toBeTruthy()
  })

  it('shows sub-agent context usage when present', () => {
    const item = subagentItem({
      subagentContextUsage: {
        step: 2,
        used: 12_000,
        window: 128_000,
        contentWindow: 110_000,
        model: 'test-model',
        updatedAt: new Date().toISOString()
      }
    })
    render(<MessageList items={[item]} />)

    expect(screen.getByText(/Sub-agent context/)).toBeTruthy()
    expect(screen.getByText(/step 2/)).toBeTruthy()
  })

  it('collapses and expands the nested group', () => {
    render(<MessageList items={[subagentItem()]} />)

    const header = screen.getByRole('button', { expanded: true })
    fireEvent.click(header)
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy()
  })
})
