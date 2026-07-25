/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MessageList } from '@renderer/features/chat/components/MessageList'
import type { UiItem } from '@shared/transcript'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  })
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
})

function gatedItems(): UiItem[] {
  return [
    { kind: 'message', id: 'u1', role: 'user', content: 'Rename the file.' },
    {
      kind: 'tool',
      id: 'call-1',
      tool: { id: 'call-1', name: 'write', summary: 'a.ts', status: 'running' },
      approval: {
        requestId: 'req-1',
        toolName: 'write',
        summary: 'a.ts',
        argsPreview: '{"path":"a.ts"}',
        mutating: true
      }
    }
  ]
}

describe('tool approval card', () => {
  it('shows the gated call and what it would run', () => {
    render(<MessageList items={gatedItems()} />)

    expect(screen.getByText('write')).toBeTruthy()
    expect(screen.getByText('modifies workspace')).toBeTruthy()
    expect(screen.getByText('{"path":"a.ts"}')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Always allow' })).toBeTruthy()
  })

  it('reports the reader decision once and locks the card', () => {
    const onApprovalDecision = vi.fn()
    render(<MessageList items={gatedItems()} onApprovalDecision={onApprovalDecision} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow for session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    expect(onApprovalDecision).toHaveBeenCalledTimes(1)
    expect(onApprovalDecision).toHaveBeenCalledWith('req-1', 'session')
  })

  it('leaves the transcript alone when nothing is gated', () => {
    const items = gatedItems().map((item) =>
      item.kind === 'tool' ? { ...item, approval: undefined } : item
    )
    render(<MessageList items={items} />)

    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull()
  })
})
