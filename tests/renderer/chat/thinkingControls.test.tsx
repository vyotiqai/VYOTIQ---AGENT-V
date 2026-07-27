/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThinkingControls } from '@renderer/features/chat/components/composer/ThinkingControls'
import { DEFAULT_SETTINGS } from '@shared/ipc'
import type { EffectiveChatSettings } from '@shared/effectiveSettings'

afterEach(() => {
  cleanup()
})

const chatSettings: EffectiveChatSettings = {
  provider: 'openai',
  model: 'gpt-5.6',
  compactionTriggerRatio: 0.7,
  keepRecentTurns: 12,
  memoryAutoPromote: true,
  thinkingEnabled: true,
  thinkingEffort: 'medium',
  showThinking: true
}

describe('ThinkingControls', () => {
  it('is hidden for non-thinking models', () => {
    const { container } = render(
      <ThinkingControls
        provider="openai"
        model="gpt-4o"
        chatSettings={chatSettings}
        onChatSettingsChange={vi.fn()}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('is hidden while the agent is running', () => {
    const { container } = render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={chatSettings}
        onChatSettingsChange={vi.fn()}
        running
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('opens popover and changes effort', () => {
    const onChatSettingsChange = vi.fn()
    render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={chatSettings}
        onChatSettingsChange={onChatSettingsChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Thinking settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /^High$/i }))
    expect(onChatSettingsChange).toHaveBeenCalledWith({ thinkingEffort: 'high' })
  })

  it('toggles thinking off', () => {
    const onChatSettingsChange = vi.fn()
    render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={chatSettings}
        onChatSettingsChange={onChatSettingsChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Thinking settings/i }))
    fireEvent.click(screen.getByLabelText(/Extended thinking/i))
    expect(onChatSettingsChange).toHaveBeenCalledWith({ thinkingEnabled: false })
  })

  it('survives switching between thinking and non-thinking models', () => {
    const onChatSettingsChange = vi.fn()
    const { container, rerender } = render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={chatSettings}
        onChatSettingsChange={onChatSettingsChange}
      />
    )

    expect(screen.getByRole('button', { name: /Thinking settings/i })).toBeTruthy()

    rerender(
      <ThinkingControls
        provider="openai"
        model="gpt-4o"
        chatSettings={chatSettings}
        onChatSettingsChange={onChatSettingsChange}
      />
    )
    expect(container.firstChild).toBeNull()

    rerender(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={chatSettings}
        onChatSettingsChange={onChatSettingsChange}
      />
    )
    expect(screen.getByRole('button', { name: /Thinking settings/i })).toBeTruthy()
  })
})
