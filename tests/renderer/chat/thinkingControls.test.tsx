/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThinkingControls } from '@renderer/features/chat/components/composer/ThinkingControls'
import type { EffectiveChatSettings } from '@shared/effectiveSettings'

afterEach(() => {
  cleanup()
})

const chatSettings: EffectiveChatSettings = {
  provider: 'openai',
  model: 'gpt-5.6',
  compactionTriggerRatio: 0.7,
  keepRecentTurns: 12,
  thinkingEnabled: true,
  thinkingEffort: 'medium',
  showThinking: true
}

function thinkingButton(): HTMLElement {
  return screen.getByRole('button', { name: /Thinking/i })
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

  it('stays visible but locked while the agent is running', () => {
    render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={chatSettings}
        onChatSettingsChange={vi.fn()}
        running
      />
    )
    const button = screen.getByRole('button', { name: /locked while running/i })
    expect(button).toBeTruthy()
    expect(button).toHaveProperty('disabled', true)
  })

  it('cycles effort forward on click', () => {
    const onChatSettingsChange = vi.fn()
    render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={chatSettings}
        onChatSettingsChange={onChatSettingsChange}
      />
    )

    fireEvent.click(thinkingButton())
    expect(onChatSettingsChange).toHaveBeenCalledWith({
      thinkingEnabled: true,
      thinkingEffort: 'high'
    })
  })

  it('cycles to off after max', () => {
    const onChatSettingsChange = vi.fn()
    render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={{ ...chatSettings, thinkingEffort: 'max' }}
        onChatSettingsChange={onChatSettingsChange}
      />
    )

    fireEvent.click(thinkingButton())
    expect(onChatSettingsChange).toHaveBeenCalledWith({ thinkingEnabled: false })
  })

  it('enables thinking from off on click', () => {
    const onChatSettingsChange = vi.fn()
    render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={{ ...chatSettings, thinkingEnabled: false }}
        onChatSettingsChange={onChatSettingsChange}
      />
    )

    fireEvent.click(thinkingButton())
    expect(onChatSettingsChange).toHaveBeenCalledWith({
      thinkingEnabled: true,
      thinkingEffort: 'minimal'
    })
  })

  it('cycles backward with shift-click', () => {
    const onChatSettingsChange = vi.fn()
    render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={chatSettings}
        onChatSettingsChange={onChatSettingsChange}
      />
    )

    fireEvent.click(thinkingButton(), { shiftKey: true })
    expect(onChatSettingsChange).toHaveBeenCalledWith({
      thinkingEnabled: true,
      thinkingEffort: 'low'
    })
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

    expect(thinkingButton()).toBeTruthy()

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
    expect(thinkingButton()).toBeTruthy()
  })

  it('does not clip short Think label with overflow-hidden', () => {
    render(
      <ThinkingControls
        provider="openai"
        model="gpt-5.6"
        chatSettings={chatSettings}
        onChatSettingsChange={vi.fn()}
      />
    )
    const button = thinkingButton()
    expect(button.className).not.toMatch(/\btruncate\b/)
    const label = button.querySelector('span')
    expect(label).toBeTruthy()
    expect(label!.className).not.toMatch(/\btruncate\b/)
    expect(label!.className).toMatch(/leading-tight/)
    expect(button.textContent).toMatch(/Think/)
  })
})
