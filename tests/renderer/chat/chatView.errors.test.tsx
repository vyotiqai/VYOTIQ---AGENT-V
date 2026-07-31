/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChatView } from '@renderer/features/chat/ChatView'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(window, 'vyotiq', {
    configurable: true,
    writable: true,
    value: {
      gitStatus: vi.fn().mockResolvedValue({ ok: true, data: { kind: 'not_repo' } }),
      browserGetState: vi.fn().mockResolvedValue({
        ok: true,
        data: { open: false, url: '', title: '' }
      }),
      onBrowserState: vi.fn().mockReturnValue(() => undefined)
    }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
    thinkingEnabled: true,
    thinkingEffort: 'medium' as const,
    showThinking: true
  },
  onChatSettingsChange: vi.fn(),
  onProviderModel: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn()
}

describe('ChatView operational errors', () => {
  it('surfaces settings errors in the chat alert (runs errors stay in sidebar)', () => {
    const onDismissError = vi.fn()
    render(
      <ChatView
        {...baseProps}
        operationalError="Failed to rename run"
        runsError="Could not list sessions"
        onDismissError={onDismissError}
      />
    )

    expect(screen.getByRole('alert').textContent).toContain('Failed to rename run')
    expect(screen.getByRole('alert').textContent).not.toContain('Could not list sessions')

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismissError).toHaveBeenCalled()
  })

  it('does not duplicate runsError into the chat banner', () => {
    render(
      <ChatView {...baseProps} runsError="Could not list sessions" onDismissError={vi.fn()} />
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows operational errors on the hero composer when workspace is unset', () => {
    render(
      <ChatView
        {...baseProps}
        hasWorkspace={false}
        workspacePath={null}
        operationalError="Pick workspace failed"
      />
    )

    expect(screen.getByRole('alert').textContent).toContain('Pick workspace failed')
    expect(document.querySelector('[data-composer-hero]')).toBeTruthy()
    expect(screen.queryByText(/No recent workspaces yet/i)).toBeNull()
  })
})
