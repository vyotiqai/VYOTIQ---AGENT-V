/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ActivityPanel } from '@renderer/features/chat/ActivityPanel'
import type { PersistedEvent } from '@shared/ipc'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('1024px'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const sampleEvents: PersistedEvent[] = [
  {
    at: '2026-07-24T10:00:00.000Z',
    event: { type: 'status', runId: 'run-1', status: 'running' }
  },
  {
    at: '2026-07-24T10:00:01.000Z',
    event: {
      type: 'tool_start',
      runId: 'run-1',
      toolCallId: 'tc-1',
      name: 'read',
      summary: 'README.md'
    }
  }
]

describe('ActivityPanel', () => {
  it('renders chronological events for a run', async () => {
    // @ts-expect-error test bridge
    window.vyotiq = {
      loadRunEvents: vi.fn(async () => ({ ok: true as const, data: sampleEvents }))
    }

    render(
      <ActivityPanel
        open
        runId="run-1"
        workspacePath="/ws"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/Run running/i)).toBeTruthy()
    })
    expect(screen.getByText(/read: README\.md/i)).toBeTruthy()
    expect(window.vyotiq.loadRunEvents).toHaveBeenCalledWith('/ws', 'run-1')
  })

  it('closes from the header button', async () => {
    const onClose = vi.fn()
    // @ts-expect-error test bridge
    window.vyotiq = {
      loadRunEvents: vi.fn(async () => ({ ok: true as const, data: [] }))
    }

    render(
      <ActivityPanel open runId="run-1" workspacePath={null} onClose={onClose} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close activity panel/i })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /close activity panel/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
