/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ChatView } from '@renderer/features/chat/ChatView'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  // The docked composer asks the main process about git as soon as it mounts.
  Object.defineProperty(window, 'vyotiq', {
    configurable: true,
    writable: true,
    value: { gitStatus: vi.fn().mockResolvedValue({ ok: true, data: null }) }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const baseProps = {
  hasOpenWorkspaces: true,
  recentPaths: [],
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
    maxSteps: 25,
    compactionTriggerRatio: 0.7,
    keepRecentTurns: 12,
    memoryAutoPromote: true,
    thinkingEnabled: true,
    thinkingEffort: 'medium' as const,
    showThinking: true
  },
  onChatSettingsChange: vi.fn(),
  onOpenRecent: vi.fn(),
  onAddWorkspace: vi.fn(),
  onProviderModel: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn()
}

describe('ChatView composer placement', () => {
  it('renders a single hero composer in empty state without dock gutter', () => {
    render(<ChatView {...baseProps} items={[]} />)

    const composers = screen.getAllByRole('textbox', { name: /^Message$/i })
    expect(composers).toHaveLength(1)

    expect(document.querySelector('[data-composer-hero]')).toBeTruthy()
    expect(screen.getByText(/\/create-rule/)).toBeTruthy()

    const composerRoot = composers[0].closest('.shrink-0')
    expect(composerRoot?.className).not.toMatch(/px-4/)
    expect(composerRoot?.className).not.toMatch(/sticky/)
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
    expect(composerRoot?.className).toMatch(/px-4/)
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
    expect(screen.getByPlaceholderText(/loading chat/i)).toBeTruthy()
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
      expect(el?.className).toMatch(/max-w-\[720px\]/)
      expect(el?.className).toMatch(/w-full/)
    }
  })
})
