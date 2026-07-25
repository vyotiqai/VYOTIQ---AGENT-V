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
    const button = screen.getByRole('button', { name: /thought/i })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Let me reason about this.')).toBeNull()

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Let me reason about this.')).toBeTruthy()
  })

  it('reads the reasoning out while it streams', () => {
    render(<ThinkingBlock content="Let me reason about this." streaming />)
    const button = screen.getByRole('button', { name: /thinking/i })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Let me reason about this.')).toBeTruthy()
  })

  it('lets the reader close the reasoning mid-stream', () => {
    render(<ThinkingBlock content="Let me reason about this." streaming />)
    fireEvent.click(screen.getByRole('button', { name: /thinking/i }))
    expect(screen.queryByText('Let me reason about this.')).toBeNull()
  })

  it('honours an explicit expanded state over the stream', () => {
    render(<ThinkingBlock content="Let me reason about this." streaming expanded={false} />)
    expect(screen.queryByText('Let me reason about this.')).toBeNull()
  })

  it('does not render placeholder-only reasoning', () => {
    const { container } = render(<ThinkingBlock content="." />)
    expect(container.firstChild).toBeNull()
  })

  it('does not render placeholder-only reasoning while streaming', () => {
    const { container } = render(<ThinkingBlock content="." streaming />)
    expect(container.firstChild).toBeNull()
  })
})
