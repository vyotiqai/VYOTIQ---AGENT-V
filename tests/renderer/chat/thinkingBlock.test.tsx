/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { ThinkingBlock } from '@renderer/features/chat/components/ThinkingBlock'

afterEach(() => {
  cleanup()
})

describe('ThinkingBlock', () => {
  it('renders collapsed by default and expands on click', () => {
    render(<ThinkingBlock content="Let me reason about this." />)
    const button = screen.getByRole('button', { name: /thinking/i })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Let me reason about this.')).toBeNull()

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Let me reason about this.')).toBeTruthy()
  })

  it('auto-expands while streaming', () => {
    render(<ThinkingBlock content="Let me reason about this." streaming />)
    const button = screen.getByRole('button', { name: /thinking/i })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Let me reason about this.')).toBeTruthy()
  })
})
