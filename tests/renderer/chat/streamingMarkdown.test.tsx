/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  MarkdownContent,
  balanceIncompleteMarkdown,
  prepareStreamingMarkdown
} from '@renderer/lib/ui/MarkdownContent'

beforeEach(() => {
  vi.stubGlobal(
    'navigator',
    Object.assign({}, navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('prepareStreamingMarkdown', () => {
  it('closes an unclosed fence without balancing inline markdown', () => {
    expect(prepareStreamingMarkdown('```\nx = a**b')).toBe('```\nx = a**b\n```')
  })

  it('does not balance bold while streaming', () => {
    expect(prepareStreamingMarkdown('Partial **bold')).toBe('Partial **bold')
  })
})

describe('balanceIncompleteMarkdown', () => {
  it('balances bold outside fences when a stream completes', () => {
    expect(balanceIncompleteMarkdown('Partial **bold')).toBe('Partial **bold**')
  })
})

describe('MarkdownContent streaming', () => {
  it('renders first streaming frame immediately', () => {
    render(<MarkdownContent content="Hello" streaming />)

    expect(screen.getByText('Hello')).toBeTruthy()
  })

  it('keeps partial bold as plain text while streaming', () => {
    render(<MarkdownContent content="Partial **bold" streaming />)

    expect(screen.getByText('Partial **bold')).toBeTruthy()
    expect(screen.queryByText('bold')?.tagName).not.toBe('STRONG')
  })

  it('renders bold after streaming completes', () => {
    const { rerender } = render(<MarkdownContent content="Partial **bold" streaming />)

    expect(screen.getByText('Partial **bold')).toBeTruthy()

    rerender(<MarkdownContent content="Partial **bold" streaming={false} />)

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.queryByText('Partial **bold')).toBeNull()
  })

  it('closes an unclosed fence as a partial code block', () => {
    render(<MarkdownContent content={'```js\nconst x = 1'} streaming />)

    expect(screen.getByText('const x = 1')).toBeTruthy()
    expect(screen.queryByText('```js')).toBeNull()
  })

  it('renders GFM tables', () => {
    render(
      <MarkdownContent
        content={'| A | B |\n| --- | --- |\n| 1 | 2 |'}
        streaming={false}
      />
    )

    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('copies fenced code from the code block button', async () => {
    render(
      <MarkdownContent
        content={'```js\nconst copied = true\n```'}
        streaming={false}
      />
    )

    const copyButton = await screen.findByRole('button', { name: 'Copy code' })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const copied = true')
    })
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('copies bare fenced code without a language tag', async () => {
    render(
      <MarkdownContent content={'```\nplain fence\n```'} streaming={false} />
    )

    const copyButton = await screen.findByRole('button', { name: 'Copy code' })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('plain fence')
    })
  })

  it('closes an unclosed tilde fence while streaming', () => {
    render(<MarkdownContent content={'~~~\nconst y = 2'} streaming />)

    expect(screen.getByText('const y = 2')).toBeTruthy()
    expect(screen.queryByText('~~~')).toBeNull()
  })

  it('does not leak react-markdown node props onto code elements', () => {
    const { container } = render(
      <MarkdownContent content="inline `code` here" streaming={false} />
    )
    const code = container.querySelector('code')
    expect(code).toBeTruthy()
    expect(code?.getAttribute('node')).toBeNull()
  })
})
