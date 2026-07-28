/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToolGroup } from '@renderer/features/chat/components/ToolGroup'
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
})

afterEach(() => {
  cleanup()
})

function toolItem(
  id: string,
  name: string,
  summary: string,
  status: 'running' | 'done' | 'fail' = 'done',
  groupTiming?: { startedAt: number; endedAt?: number }
): Extract<UiItem, { kind: 'tool' }> {
  return {
    kind: 'tool',
    id,
    groupTiming,
    tool: { id, name, summary, status }
  }
}

describe('ToolGroup', () => {
  it('shows shimmer label while pending', () => {
    const tools = [
      toolItem('t1', 'read', 'a.ts', 'running', { startedAt: Date.now() }),
      toolItem('t2', 'search', 'query', 'running')
    ]
    render(<ToolGroup tools={tools} />)
    expect(screen.getByText('Reading and searching')).toBeTruthy()
    expect(screen.getByText('1 file and 1 lookup')).toBeTruthy()
  })

  it('lists the calls as they land while the group is still running', () => {
    const tools = [
      toolItem('t1', 'read', 'a.ts', 'done', { startedAt: Date.now() }),
      toolItem('t2', 'read', 'b.ts', 'running')
    ]
    render(<ToolGroup tools={tools} />)

    const toggle = screen.getByRole('button', { name: /Reading 2 files/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('a.ts')).toBeTruthy()
    expect(screen.getByText('b.ts')).toBeTruthy()
    expect(document.querySelectorAll('.vy-text-shimmer--active').length).toBeGreaterThan(1)
  })

  it('shows completed label and summary when group is closed', () => {
    const tools = [
      toolItem('t1', 'read', 'a.ts', 'done', { startedAt: 1_000, endedAt: 7_000 }),
      toolItem('t2', 'search', 'query', 'done')
    ]
    render(<ToolGroup tools={tools} />)
    expect(screen.getByText('Read and searched')).toBeTruthy()
    expect(screen.getByText('1 file and 1 lookup')).toBeTruthy()
    expect(screen.getByText('6s')).toBeTruthy()
    expect(screen.queryByText('a.ts')).toBeNull()
  })

  it('marks an interrupted group without hiding what it did', () => {
    const tools = [
      toolItem('t1', 'read', 'a.ts', 'fail', { startedAt: 1_000, endedAt: 2_000 })
    ]
    tools[0]!.tool.content = 'Cancelled'
    render(<ToolGroup tools={tools} />)
    expect(screen.getByText('interrupted')).toBeTruthy()
    expect(screen.getByText('Read')).toBeTruthy()
    expect(screen.getByText(/a\.ts/)).toBeTruthy()
  })

  it('does not duplicate list_dir path in the expanded body when shown as activity', () => {
    const tools = [
      toolItem('t1', 'list_dir', 'src', 'done', { startedAt: 1_000, endedAt: 2_000 })
    ]
    tools[0]!.tool.content = JSON.stringify({
      path: 'src',
      entries: [{ name: 'a.ts', type: 'file' }]
    })
    tools[0]!.tool.argsPreview = '{"path":"src"}'
    render(<ToolGroup tools={tools} groupExpanded />)
    // Path appears in the compact subtitle; body must not repeat a path header.
    expect(screen.getAllByText(/src/).length).toBe(1)
  })

  it('names the group after a single kind of work', () => {
    render(
      <ToolGroup
        tools={[
          toolItem('t1', 'terminal', 'npm run build'),
          toolItem('t2', 'terminal', 'npm test')
        ]}
      />
    )
    expect(screen.getByText('Ran')).toBeTruthy()
    expect(screen.getByText('2 commands')).toBeTruthy()
  })

  it('keeps every opened call open, not just the first', () => {
    const tools = [
      toolItem('t1', 'read', 'a.ts', 'done', { startedAt: 1_000, endedAt: 2_000 }),
      toolItem('t2', 'read', 'b.ts'),
      toolItem('t3', 'read', 'c.ts')
    ]
    tools[0]!.tool.content = 'alpha output'
    tools[1]!.tool.content = 'beta output'
    tools[2]!.tool.content = 'gamma output'

    render(
      <ToolGroup tools={tools} groupExpanded expandedToolIds={new Set(['t1', 't3'])} />
    )

    expect(screen.getByText('alpha output')).toBeTruthy()
    expect(screen.getByText('gamma output')).toBeTruthy()
    expect(screen.queryByText('beta output')).toBeNull()
  })

  it('follows the host disclosure state instead of local state', () => {
    const tools = [toolItem('t1', 'read', 'a.ts', 'done', { startedAt: 1_000, endedAt: 2_000 })]
    tools[0]!.tool.content = 'alpha output'
    const onGroupToggle = vi.fn()

    const { rerender } = render(
      <ToolGroup tools={tools} groupExpanded={false} onGroupToggle={onGroupToggle} />
    )
    fireEvent.click(screen.getByRole('button', { name: /Read/i }))

    expect(onGroupToggle).toHaveBeenCalledWith(true)
    // Still closed: the host owns the state and has not applied the change yet.
    expect(screen.queryByText('alpha output')).toBeNull()

    rerender(<ToolGroup tools={tools} groupExpanded onGroupToggle={onGroupToggle} />)
    expect(screen.getByText('alpha output')).toBeTruthy()
  })

  it('spans elapsed time across batches that only carry partial timing', () => {
    render(
      <ToolGroup
        tools={[
          toolItem('t1', 'read', 'a.ts', 'done', { startedAt: 1_000, endedAt: 3_000 }),
          toolItem('t2', 'read', 'b.ts'),
          toolItem('t3', 'read', 'c.ts', 'done', { startedAt: 4_000, endedAt: 9_000 })
        ]}
      />
    )
    expect(screen.getByText('8s')).toBeTruthy()
  })

  it('auto-expands nested tool bodies while a multi-tool group is pending', () => {
    const tools = [
      toolItem('s1', 'subagent', 'Audit core', 'running', { startedAt: Date.now() }),
      toolItem('s2', 'subagent', 'Audit API', 'running')
    ]

    render(<ToolGroup tools={tools} />)

    expect(screen.getByRole('button', { name: /Investigating/i }).getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(screen.getByText('Audit core')).toBeTruthy()
    expect(screen.getByText('Audit API')).toBeTruthy()
  })
})
