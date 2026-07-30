/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChatView } from '@renderer/features/chat/ChatView'
import { COMPOSER_DOCK_CLEARANCE_PX, COMPOSER_DOCK_FADE_PX } from '@renderer/lib/utils/layout'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  try {
    localStorage.removeItem('vyotiq.browserPanelOpen')
    localStorage.removeItem('vyotiq.rightPanel')
    localStorage.removeItem('vyotiq.browserRecents')
  } catch {
    /* ignore */
  }
  // The docked composer asks the main process about git as soon as it mounts.
  Object.defineProperty(window, 'vyotiq', {
    configurable: true,
    writable: true,
    value: {
      gitStatus: vi.fn().mockResolvedValue({ ok: true, data: null }),
      browserGetState: vi.fn().mockResolvedValue({
        ok: true,
        data: { open: false, url: '', title: '' }
      }),
      onBrowserState: vi.fn().mockReturnValue(() => undefined),
      browserSetBounds: vi.fn().mockResolvedValue({ ok: true, data: true }),
      browserNavigate: vi.fn().mockResolvedValue({ ok: true, data: true }),
      browserReload: vi.fn().mockResolvedValue({ ok: true, data: true }),
      browserTakeScreenshot: vi.fn().mockResolvedValue({
        ok: true,
        data: { path: '/tmp/snapshot.jpg' }
      }),
      browserClearBrowsingData: vi.fn().mockResolvedValue({
        ok: true,
        data: { cleared: 'history' }
      })
    }
  })
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
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const baseProps = {
  items: [],
  running: false,
  error: null,
  hasWorkspace: true,
  workspacePath: '/ws',
  provider: 'ollama' as const,
  model: 'qwen2.5',
  activeRunId: null,
  chatSettings: {
    provider: 'ollama' as const,
    model: 'qwen2.5',
    compactionTriggerRatio: 0.7,
    keepRecentTurns: 12,
    memoryAutoPromote: true,
    thinkingEnabled: true,
    thinkingEffort: 'medium' as const,
    showThinking: true
  },
  onChatSettingsChange: vi.fn(),
  onProviderModel: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn()
}

describe('ChatView composer placement', () => {
  it('shows a side rail that opens the browser panel', () => {
    render(<ChatView {...baseProps} items={[]} />)

    expect(document.querySelector('[data-chat-side-rail]')).toBeTruthy()
    expect(document.querySelector('[data-agent-browser-panel]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Show browser panel/i }))
    expect(document.querySelector('[data-agent-browser-panel]')).toBeTruthy()
    expect(document.querySelector('[data-agent-browser-viewport]')).toBeTruthy()
    expect(document.querySelector('[data-chat-side-rail]')).toBeTruthy()
    expect(screen.getByText('No page loaded')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search or enter URL')).toBeTruthy()
  })

  it('switches docked panels from the side rail', () => {
    render(<ChatView {...baseProps} items={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /Show terminal panel/i }))
    expect(document.querySelector('[data-terminal-panel]')).toBeTruthy()
    expect(screen.getByText('No terminal output yet')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Show changes panel/i }))
    expect(document.querySelector('[data-changes-panel]')).toBeTruthy()
    expect(document.querySelector('[data-terminal-panel]')).toBeNull()
    expect(screen.getByText('No changes yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /files panel/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Hide changes panel$/i }))
    expect(document.querySelector('[data-changes-panel]')).toBeNull()
  })

  it('does not steal Terminal when browser state keeps reporting open', () => {
    let browserHandler: ((state: { open: boolean; url: string; title: string }) => void) | null =
      null
    Object.defineProperty(window, 'vyotiq', {
      configurable: true,
      writable: true,
      value: {
        ...(window.vyotiq as object),
        browserGetState: vi.fn().mockResolvedValue({
          ok: true,
          data: { open: true, url: 'https://example.com', title: 'Example' }
        }),
        onBrowserState: vi.fn((handler: typeof browserHandler) => {
          browserHandler = handler
          return () => {
            browserHandler = null
          }
        })
      }
    })

    localStorage.setItem('vyotiq.rightPanel', 'terminal')
    render(<ChatView {...baseProps} items={[]} />)

    expect(document.querySelector('[data-terminal-panel]')).toBeTruthy()
    expect(document.querySelector('[data-agent-browser-panel]')).toBeNull()

    browserHandler?.({ open: true, url: 'https://example.com/x', title: 'Example' })
    expect(document.querySelector('[data-terminal-panel]')).toBeTruthy()
    expect(document.querySelector('[data-agent-browser-panel]')).toBeNull()
  })

  it('restores the Plan panel from localStorage on mount', () => {
    localStorage.setItem('vyotiq.rightPanel', 'plan')
    render(<ChatView {...baseProps} items={[]} />)

    expect(document.querySelector('[data-plan-panel]')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Hide plan panel/i })).toBeTruthy()
  })

  it('does not steal Plan when browser opens on a rising edge', () => {
    let browserHandler: ((state: { open: boolean; url: string; title: string }) => void) | null =
      null
    Object.defineProperty(window, 'vyotiq', {
      configurable: true,
      writable: true,
      value: {
        ...(window.vyotiq as object),
        browserGetState: vi.fn().mockResolvedValue({
          ok: true,
          data: { open: false, url: '', title: '' }
        }),
        onBrowserState: vi.fn((handler: typeof browserHandler) => {
          browserHandler = handler
          return () => {
            browserHandler = null
          }
        })
      }
    })

    localStorage.setItem('vyotiq.rightPanel', 'plan')
    render(<ChatView {...baseProps} items={[]} />)

    expect(document.querySelector('[data-plan-panel]')).toBeTruthy()
    expect(document.querySelector('[data-agent-browser-panel]')).toBeNull()

    browserHandler?.({ open: true, url: 'https://example.com', title: 'Example' })
    expect(document.querySelector('[data-plan-panel]')).toBeTruthy()
    expect(document.querySelector('[data-agent-browser-panel]')).toBeNull()
  })

  it('shows Recents in the empty browser panel when history exists', () => {
    localStorage.setItem(
      'vyotiq.browserRecents',
      JSON.stringify([
        {
          url: 'https://example.com',
          title: 'Example Domain',
          visitedAt: Date.now()
        }
      ])
    )
    render(<ChatView {...baseProps} items={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /Show browser panel/i }))
    expect(screen.getByText('Recents')).toBeTruthy()
    expect(screen.getByText('Example Domain')).toBeTruthy()
  })

  it('renders a single hero composer in empty state without dock gutter', () => {
    render(<ChatView {...baseProps} items={[]} />)

    const composers = screen.getAllByRole('textbox', { name: /^Message$/i })
    expect(composers).toHaveLength(1)

    expect(document.querySelector('[data-composer-hero]')).toBeTruthy()
    expect(screen.queryByText(/Type \/ for commands/i)).toBeNull()

    const composerRoot = composers[0].closest('.shrink-0')
    expect(composerRoot?.className).not.toMatch(/px-4/)
    expect(composerRoot?.className).not.toMatch(/sticky/)
  })

  it('renders a floating edge rail over the chat stage', () => {
    render(
      <ChatView
        {...baseProps}
        items={[
          {
            kind: 'message',
            id: 'm1',
            role: 'user',
            content: 'hello',
            at: '2024-01-01T00:00:00.000Z'
          }
        ]}
      />
    )

    const rail = document.querySelector('[data-chat-side-rail]')
    expect(rail?.className).toMatch(/absolute/)
    expect(rail?.className).toMatch(/right-0/)
    expect(document.querySelector('[data-composer-dock]')?.className).toMatch(/pr-10/)
    expect(document.querySelector('[data-transcript-scroll]')?.className).toMatch(/pr-10/)
  })

  it('keeps open right panels clear of the floating rail', () => {
    render(<ChatView {...baseProps} items={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /Show plan panel/i }))
    const panel = document.querySelector('[data-plan-panel]')
    expect(panel?.className).toMatch(/pr-10/)
    expect(panel?.className).toMatch(/min-w-0/)
  })

  it('renders docked composer with gutter when transcript has messages', () => {
    render(
      <ChatView
        {...baseProps}
        items={[
          {
            kind: 'message',
            id: 'm1',
            role: 'user',
            content: 'hello',
            at: '2024-01-01T00:00:00.000Z'
          }
        ]}
      />
    )

    const composerRoot = document.querySelector('[data-composer-dock]')
    expect(composerRoot?.className).toMatch(/pl-4/)
    expect(composerRoot?.className).toMatch(/pr-10/)
    expect(composerRoot?.className).toMatch(/absolute/)
  })

  it('uses dock layout while loading transcript for an active run', () => {
    render(
      <ChatView
        {...baseProps}
        items={[]}
        activeRunId="run-1"
        transcriptLoading
      />
    )

    expect(document.querySelector('[data-composer-hero]')).toBeNull()
    expect(document.querySelector('[data-composer-dock]')).toBeTruthy()
    expect(screen.getAllByText(/loading chat/i).length).toBeGreaterThan(0)
  })

  it('uses dock layout for an active run tab with no messages', () => {
    render(<ChatView {...baseProps} items={[]} activeRunId="run-1" />)

    expect(document.querySelector('[data-composer-hero]')).toBeNull()
    expect(screen.queryByText(/\/create-rule/)).toBeNull()
  })

  it('aligns docked composer with the transcript column', () => {
    render(
      <ChatView
        {...baseProps}
        items={[
          {
            kind: 'message',
            id: 'm1',
            role: 'user',
            content: 'hello',
            at: '2024-01-01T00:00:00.000Z'
          }
        ]}
      />
    )

    const transcriptColumn = document.querySelector('[data-chat-column]')
    const composerColumn = document.querySelector('[data-composer-column]')
    for (const el of [transcriptColumn, composerColumn]) {
      expect(el?.className).toMatch(/mx-auto/)
      expect(el?.className).toMatch(/max-w-\[840px\]/)
      expect(el?.className).toMatch(/w-full/)
    }
  })

  it('reserves dock height plus fade so the transcript clears the composer', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.hasAttribute('data-composer-dock')) return 120
      return 0
    })

    render(
      <ChatView
        {...baseProps}
        items={[
          {
            kind: 'message',
            id: 'm1',
            role: 'user',
            content: 'hello',
            at: '2024-01-01T00:00:00.000Z'
          }
        ]}
      />
    )

    const stage = document.querySelector('[data-chat-stage]') as HTMLElement | null
    const transcript = document.querySelector('[data-transcript-scroll]') as HTMLElement | null
    expect(stage).toBeTruthy()
    expect(transcript).toBeTruthy()
    expect(stage!.style.getPropertyValue('--vy-dock-h')).toBe(
      `${120 + COMPOSER_DOCK_FADE_PX + COMPOSER_DOCK_CLEARANCE_PX}px`
    )
    expect(transcript!.style.paddingBottom).toBe('var(--vy-dock-h, 8rem)')
  })

  it('remounts the transcript when chatSurfaceEpoch changes but not for draft alone', () => {
    const items = [
      {
        kind: 'message' as const,
        id: 'm1',
        role: 'user' as const,
        content: 'hello',
        at: '2024-01-01T00:00:00.000Z'
      }
    ]
    const { rerender } = render(
      <ChatView {...baseProps} items={items} chatSurfaceEpoch={0} activeRunId={null} />
    )
    const first = document.querySelector('[data-transcript-scroll]')
    expect(first).toBeTruthy()

    rerender(
      <ChatView {...baseProps} items={items} chatSurfaceEpoch={0} activeRunId="run-1" />
    )
    expect(document.querySelector('[data-transcript-scroll]')).toBe(first)

    rerender(
      <ChatView {...baseProps} items={items} chatSurfaceEpoch={1} activeRunId="run-1" />
    )
    expect(document.querySelector('[data-transcript-scroll]')).not.toBe(first)
  })
})
