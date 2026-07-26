/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
    groupTiming: i === 0 ? { startedAt: 1_000, endedAt: 2_000 } : undefined
  }))
}

describe('MessageList', () => {
  it('keeps the narration between tool batches on the page', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'a1', role: 'assistant', content: 'First look.' },
      ...toolGroup('alpha', ['alpha-one.ts', 'alpha-two.ts']),
      { kind: 'message', id: 'a2', role: 'assistant', content: 'Next batch.' },
      ...toolGroup('beta', ['beta-only.ts'])
    ]

    render(<MessageList items={items} />)

    expect(screen.getByText('First look.')).toBeTruthy()
    expect(screen.getByText('Next batch.')).toBeTruthy()
    // Narration separates the two batches, so each keeps its own header.
    expect(screen.getAllByText('Read')).toHaveLength(2)
    expect(screen.getByText('2 files')).toBeTruthy()
    expect(screen.getByText('beta-only.ts')).toBeTruthy()

    const body = document.querySelector('[data-transcript-scroll]')?.textContent ?? ''
    expect(body.indexOf('First look.')).toBeLessThan(body.indexOf('Next batch.'))
  })

  it('streams assistant text and reasoning inline, mid tool loop', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'audit it' },
      ...toolGroup('alpha', ['alpha-one.ts']),
      {
        kind: 'message',
        id: 'a2',
        role: 'assistant',
        content: 'Now checking how the router is wired.',
        thinking: 'The table is built up front.',
        thinkingStreaming: true,
        streaming: true
      }
    ]

    render(<MessageList items={items} />)

    expect(screen.getByText('Now checking how the router is wired.')).toBeTruthy()
    expect(screen.getByText('The table is built up front.')).toBeTruthy()
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

    const container = document.querySelector('[data-transcript-scroll]') as HTMLDivElement
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

  it('renders every row in a long transcript', () => {
    const items: UiItem[] = Array.from({ length: 45 }, (_, i) => ({
      kind: 'message' as const,
      id: `m-${i}`,
      role: 'assistant' as const,
      content: `Line ${i}`
    }))

    render(<MessageList items={items} />)

    expect(screen.getByText('Line 0')).toBeTruthy()
    expect(screen.getByText('Line 44')).toBeTruthy()
    expect(document.querySelectorAll('[data-index]')).toHaveLength(0)
  })

  it('groups consecutive tool rows in long threads', () => {
    const pad = Array.from({ length: 40 }, (_, i) => ({
      kind: 'message' as const,
      id: `pad-${i}`,
      role: 'assistant' as const,
      content: `pad ${i}`
    }))
    const tools = toolGroup('tail', ['one.ts', 'two.ts', 'three.ts'])
    const items: UiItem[] = [...pad, ...tools]

    render(<MessageList items={items} />)

    expect(screen.getByText('3 files')).toBeTruthy()
    expect(screen.getByText('pad 0')).toBeTruthy()
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

  it('follows the tail via scrollHeight so dock padding stays clear', async () => {
    class ResizeObserverStub {
      private readonly cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      observe(): void {
        this.cb([], this as unknown as ResizeObserver)
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)

    const items: UiItem[] = Array.from({ length: 12 }, (_, i) => ({
      kind: 'message' as const,
      id: `m-${i}`,
      role: 'assistant' as const,
      content: `Line ${i}`
    }))

    const { rerender } = render(
      <MessageList items={items} reserveComposerSpace dockReservePx={180} />
    )
    const scroll = document.querySelector('[data-transcript-scroll]') as HTMLDivElement
    expect(scroll).toBeTruthy()

    let scrollTop = 0
    const scrollTopSet = vi.fn((value: number) => {
      scrollTop = value
    })
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 400 })
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 4000 })
    Object.defineProperty(scroll, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: scrollTopSet
    })

    // Leave headroom so the follow-tail effect does not early-return.
    scrollTop = 3500

    const next = [
      ...items,
      {
        kind: 'message' as const,
        id: 'm-tail',
        role: 'assistant' as const,
        content: 'new line'
      }
    ]
    rerender(<MessageList items={next} reserveComposerSpace dockReservePx={180} />)

    await vi.waitFor(() => {
      expect(scrollTopSet).toHaveBeenCalled()
    })
    expect(scrollTopSet).toHaveBeenCalledWith(4000)
    expect(scroll.style.paddingBottom).toBe('var(--vy-dock-h, 8rem)')

    vi.unstubAllGlobals()
  })

  it('re-follows the tail when dock reserve grows while pinned', async () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'msg-1', role: 'assistant', content: 'Hello' }
    ]
    const { rerender } = render(
      <MessageList items={items} reserveComposerSpace dockReservePx={120} />
    )
    const scroll = document.querySelector('[data-transcript-scroll]') as HTMLDivElement
    let scrollTop = 0
    const scrollTopSet = vi.fn((value: number) => {
      scrollTop = value
    })
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 400 })
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(scroll, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: scrollTopSet
    })
    scrollTop = 400

    rerender(<MessageList items={items} reserveComposerSpace dockReservePx={200} />)

    await vi.waitFor(() => {
      expect(scrollTopSet).toHaveBeenCalledWith(900)
    })
  })
})
