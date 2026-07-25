/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ModelPicker } from '@renderer/features/chat/components/composer/ModelPicker'
import type { ModelPickerOption } from '@renderer/features/chat/components/composer/composerModelUtils'

afterEach(() => {
  cleanup()
})

const openaiOptions: ModelPickerOption[] = [
  {
    value: 'openai::gpt-5.6',
    label: 'gpt-5.6',
    group: 'OpenAI',
    meta: {
      id: 'gpt-5.6',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      supportsVision: true,
      supportsThinking: true,
      supportedServiceTiers: ['default', 'flex', 'priority']
    }
  },
  {
    value: 'openai::gpt-4.1',
    label: 'gpt-4.1',
    group: 'OpenAI',
    meta: {
      id: 'gpt-4.1',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      supportsVision: false,
      supportsThinking: false
    }
  }
]

const optionsByProvider = {
  openai: openaiOptions,
  anthropic: [
    {
      value: 'anthropic::claude-sonnet-5',
      label: 'claude-sonnet-5',
      group: 'Anthropic',
      meta: {
        id: 'claude-sonnet-5',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsTools: true,
        supportsVision: true,
        supportsThinking: true
      }
    }
  ],
  gemini: [],
  ollama: [],
  deepseek: [],
  groq: [],
  openrouter: [],
  xai: [],
  mistral: []
} as Record<import('@shared/ipc').ProviderId, ModelPickerOption[]>

const seedsByProvider = { ...optionsByProvider }

describe('ModelPicker', () => {
  it('opens panel with provider tabs and no agent settings', () => {
    render(
      <ModelPicker
        providers={['openai', 'anthropic']}
        optionsByProvider={optionsByProvider}
        seedsByProvider={seedsByProvider}
        modelMetaByValue={{ 'openai::gpt-5.6': openaiOptions[0].meta! }}
        provider="openai"
        model="gpt-5.6"
        favoriteModels={[]}
        recentModels={[]}
        modelsWarning={null}
        serviceTier="default"
        onModelChange={vi.fn()}
        onToggleFavorite={vi.fn()}
        onServiceTierChange={vi.fn()}
        onRefreshCatalog={vi.fn()}
        triggerClassName="test-trigger"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Select model/i }))
    expect(screen.getByRole('listbox', { name: /Select model/i })).toBeTruthy()
    expect(screen.getByText('OpenAI')).toBeTruthy()
    expect(screen.queryByLabelText(/Max steps/i)).toBeNull()
  })

  it('selects a model without closing requirement enforced by parent', () => {
    const onModelChange = vi.fn()
    render(
      <ModelPicker
        providers={['openai', 'anthropic']}
        optionsByProvider={optionsByProvider}
        seedsByProvider={seedsByProvider}
        modelMetaByValue={{}}
        provider="openai"
        model="gpt-5.6"
        favoriteModels={[]}
        recentModels={[]}
        modelsWarning={null}
        serviceTier="default"
        onModelChange={onModelChange}
        onToggleFavorite={vi.fn()}
        onServiceTierChange={vi.fn()}
        onRefreshCatalog={vi.fn()}
        triggerClassName="test-trigger"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Select model/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Anthropic$/i }))
    fireEvent.click(screen.getByRole('option', { name: /claude-sonnet-5/i }))
    expect(onModelChange).toHaveBeenCalledWith('anthropic', 'claude-sonnet-5')
  })

  it('shows speed footer for capable models', () => {
    const onServiceTierChange = vi.fn()
    render(
      <ModelPicker
        providers={['openai']}
        optionsByProvider={optionsByProvider}
        seedsByProvider={seedsByProvider}
        modelMetaByValue={{ 'openai::gpt-5.6': openaiOptions[0].meta! }}
        provider="openai"
        model="gpt-5.6"
        favoriteModels={[]}
        recentModels={[]}
        modelsWarning={null}
        serviceTier="default"
        onModelChange={vi.fn()}
        onToggleFavorite={vi.fn()}
        onServiceTierChange={onServiceTierChange}
        onRefreshCatalog={vi.fn()}
        triggerClassName="test-trigger"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Select model/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Priority$/i }))
    expect(onServiceTierChange).toHaveBeenCalledWith('priority')
  })

  it('shows catalog warning banner', () => {
    render(
      <ModelPicker
        providers={['openai']}
        optionsByProvider={optionsByProvider}
        seedsByProvider={seedsByProvider}
        modelMetaByValue={{}}
        provider="openai"
        model="gpt-5.6"
        favoriteModels={[]}
        recentModels={[]}
        modelsWarning="Using offline model list"
        serviceTier="default"
        onModelChange={vi.fn()}
        onToggleFavorite={vi.fn()}
        onServiceTierChange={vi.fn()}
        onRefreshCatalog={vi.fn()}
        triggerClassName="test-trigger"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Select model/i }))
    expect(screen.getByText(/offline model list/i)).toBeTruthy()
  })
})
