/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MessageList, VIRTUALIZE_THRESHOLD } from '@renderer/features/chat/components/MessageList'
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
    groupTiming: i === 0 ? { startedAt: 1_000, endedAt: 2_000 } : undefined
  }))
}

describe('MessageList', () => {
  it('renders tool groups with ToolGroup and single tools with ToolRow', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'a1', role: 'assistant', content: 'First look.' },
      ...toolGroup('alpha', ['alpha-one.ts', 'alpha-two.ts']),
      { kind: 'message', id: 'a2', role: 'assistant', content: 'Next batch.' },
      ...toolGroup('beta', ['beta-only.ts'])
    ]

    render(<MessageList items={items} />)

    expect(screen.getByText('First look.')).toBeTruthy()
    expect(screen.getByText('Explored')).toBeTruthy()
    expect(screen.getByText('2 files')).toBeTruthy()
    expect(screen.getByText('Next batch.')).toBeTruthy()
    expect(screen.getByText(/beta-only\.ts/)).toBeTruthy()
    expect(screen.queryByText(/Worked for/i)).toBeNull()

    const body = document.querySelector('[aria-live="polite"]')?.textContent ?? ''
    expect(body.indexOf('First look.')).toBeLessThan(body.indexOf('Explored'))
    expect(body.indexOf('2 files')).toBeLessThan(body.indexOf('Next batch.'))
    expect(body.indexOf('Next batch.')).toBeLessThan(body.indexOf('beta-only'))
  })

  it('does not re-apply scroll restore when restoreScrollTop updates without a new token', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'msg-1', role: 'assistant', content: 'Hello', streaming: true }
    ]

    const scrollTopSpy = vi.fn()
    const { rerender } = render(
      <MessageList
        items={items}
        restoreScrollTop={100}
        scrollRestoreToken={1}
        onScrollTopChange={scrollTopSpy}
      />
    )

    const container = document.querySelector('[aria-live="polite"]') as HTMLDivElement
    expect(container).toBeTruthy()

    const initialScrollTop = container.scrollTop
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => initialScrollTop,
      set: vi.fn()
    })

    rerender(
      <MessageList
        items={[
          { kind: 'message', id: 'msg-1', role: 'assistant', content: 'Hello world', streaming: true }
        ]}
        restoreScrollTop={250}
        scrollRestoreToken={1}
        onScrollTopChange={scrollTopSpy}
      />
    )

    expect(container.scrollTop).toBe(initialScrollTop)
  })

  it('virtualizes long transcripts without mounting every row', () => {
    const items: UiItem[] = Array.from({ length: VIRTUALIZE_THRESHOLD + 5 }, (_, i) => ({
      kind: 'message' as const,
      id: `m-${i}`,
      role: 'assistant' as const,
      content: `Line ${i}`
    }))

    const { container } = render(<MessageList items={items} />)
    const scroll = container.querySelector('[aria-live="polite"]') as HTMLDivElement | null
    expect(scroll).toBeTruthy()
    if (scroll) {
      Object.defineProperty(scroll, 'clientHeight', { value: 480, configurable: true })
    }
    expect(document.querySelectorAll('[data-index]').length).toBeLessThan(items.length)
  })

  it('groups consecutive tool rows into one virtual row for long threads', () => {
    const pad = Array.from({ length: VIRTUALIZE_THRESHOLD }, (_, i) => ({
      kind: 'message' as const,
      id: `pad-${i}`,
      role: 'assistant' as const,
      content: `pad ${i}`
    }))
    const tools = toolGroup('tail', ['one.ts', 'two.ts', 'three.ts'])
    const items: UiItem[] = [...pad, ...tools]

    const { container } = render(<MessageList items={items} />)
    const scroll = container.querySelector('[aria-live="polite"]') as HTMLDivElement | null
    expect(scroll).toBeTruthy()
    if (scroll) {
      Object.defineProperty(scroll, 'clientHeight', { value: 480, configurable: true })
    }
    const mountedRows = document.querySelectorAll('[data-index]').length
    // 40 messages + 1 grouped tool stretch = 41 virtual rows vs 43 items
    expect(mountedRows).toBeLessThan(items.length)
    expect(mountedRows).toBeLessThanOrEqual(12)
  })

  it('uses instant tail follow while streaming', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView

    const items: UiItem[] = [
      { kind: 'message', id: 'msg-1', role: 'assistant', content: 'Streaming', streaming: true }
    ]

    render(<MessageList items={items} />)

    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
