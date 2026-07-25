/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { Composer } from '@renderer/features/chat/components/composer'
import { DEFAULT_SETTINGS } from '@shared/ipc'
import type { EffectiveChatSettings } from '@shared/effectiveSettings'

afterEach(() => {
  cleanup()
})

const chatSettings: EffectiveChatSettings = {
  provider: 'ollama',
  model: 'qwen2.5',
  maxSteps: DEFAULT_SETTINGS.maxSteps,
  compactionTriggerRatio: DEFAULT_SETTINGS.compactionTriggerRatio,
  keepRecentTurns: DEFAULT_SETTINGS.keepRecentTurns,
  memoryAutoPromote: DEFAULT_SETTINGS.memoryAutoPromote,
  thinkingEnabled: DEFAULT_SETTINGS.thinkingEnabled,
  thinkingEffort: DEFAULT_SETTINGS.thinkingEffort,
  showThinking: DEFAULT_SETTINGS.showThinking
}

beforeEach(() => {
  // @ts-expect-error test bridge
  window.vyotiq = {
    listModels: vi.fn(async () => ({
      ok: true as const,
      data: {
        models: [
          {
            id: 'gpt-5.6',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsTools: true,
            supportsVision: false
          }
        ],
        warning: 'seed'
      }
    }))
  }
})

describe('Composer', () => {
  it('uses custom model menu not select', () => {
    const onProviderModel = vi.fn()
    render(
      <Composer
        provider="ollama"
        model="qwen2.5"
        running={false}
        chatSettings={{ ...chatSettings, provider: 'ollama', model: 'qwen2.5' }}
        onChatSettingsChange={vi.fn()}
        onProviderModel={onProviderModel}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />
    )

    expect(document.querySelector('select')).toBeNull()
    const modelBtn = screen.getByRole('button', { name: /Select model/i })
    fireEvent.click(modelBtn)
    const listbox = screen.getByRole('listbox')
    fireEvent.click(within(listbox).getByText('llama3.2'))
    expect(onProviderModel).toHaveBeenCalledWith('ollama', 'llama3.2')
    expect(screen.getByRole('listbox')).toBeTruthy()
  })

  it('restores composer draft when send reports failure', async () => {
    const onSend = vi.fn(async () => false)
    render(
      <Composer
        provider="ollama"
        model="qwen2.5"
        running={false}
        chatSettings={chatSettings}
        onChatSettingsChange={vi.fn()}
        onProviderModel={vi.fn()}
        onSend={onSend}
        onStop={vi.fn()}
      />
    )

    const ta = screen.getByRole('textbox', { name: /^Message$/i }) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'keep me' } })
    fireEvent.click(screen.getByRole('button', { name: /^Send$/i }))

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('keep me', undefined)
    })
    await waitFor(() => {
      expect(ta.value).toBe('keep me')
    })
  })

  it('filters seed model menu for vision when images are attached', async () => {
    // @ts-expect-error test bridge
    window.vyotiq.listModels = vi.fn(async () => ({
      ok: false as const,
      error: 'offline'
    }))
    render(
      <Composer
        provider="openai"
        model="gpt-4.1"
        running={false}
        hasWorkspace
        chatSettings={{ ...chatSettings, provider: 'openai', model: 'gpt-4.1' }}
        onChatSettingsChange={vi.fn()}
        onProviderModel={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />
    )

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['pixels'], 'shot.png', { type: 'image/png' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fireEvent.change(fileInput)

    await waitFor(() => {
      expect(screen.getByText(/Image 1/i)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: /Select model/i }))
    const listbox = screen.getByRole('listbox')
    expect(within(listbox).queryByText('gpt-4.1')).toBeNull()
    expect(within(listbox).getByText('gpt-4o')).toBeTruthy()
  })

  it('disables textarea while a run is in progress', () => {
    render(
      <Composer
        provider="ollama"
        model="qwen2.5"
        running
        chatSettings={chatSettings}
        onChatSettingsChange={vi.fn()}
        onProviderModel={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />
    )

    const ta = screen.getByRole('textbox', { name: /^Message$/i }) as HTMLTextAreaElement
    expect(ta.disabled).toBe(true)
    expect(screen.getByRole('status', { name: /working/i })).toBeTruthy()
  })
})
