/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ContextMeter } from '@renderer/features/chat/components/composer/ContextMeter'
import type { ContextUsageState } from '@shared/utils/contextUsage'

const usage: ContextUsageState = {
  step: 3,
  used: 45000,
  estimatedTokens: 44000,
  inputTokens: 45000,
  window: 128000,
  contentWindow: 89600,
  compactionTrigger: 62720,
  source: 'provider',
  layers: { system: 5000, history: 32000, tools: 7000, buffer: 19200 },
  stepUsage: { inputTokens: 45000, outputTokens: 1200, cachedInputTokens: 20000, steps: 3 },
  updatedAt: '2026-01-01T12:00:00.000Z'
}

describe('ContextMeter', () => {
  it('opens a structured breakdown popover on click', () => {
    render(<ContextMeter usage={usage} />)

    const trigger = screen.getByRole('button', { name: /context window/i })
    expect(trigger.textContent).toContain('45k')
    expect(trigger.textContent).toContain('90k')

    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: /context window breakdown/i })
    expect(dialog).toBeTruthy()
    expect(screen.getByText(/^Layers$/i)).toBeTruthy()
    expect(screen.getByText(/^Telemetry$/i)).toBeTruthy()
    expect(screen.getByText(/Step usage/i)).toBeTruthy()
    expect(screen.getByText(/Prompt cache/i)).toBeTruthy()
    expect(screen.getByText(/Compaction at/i)).toBeTruthy()
    expect(screen.getByText(/Content budget/i)).toBeTruthy()
  })
})
