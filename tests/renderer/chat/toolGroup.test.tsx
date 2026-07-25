/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
    render(<ToolGroup tools={tools} defaultOpen />)
    expect(screen.getByText('Exploring')).toBeTruthy()
    expect(screen.getByText('1 file and 1 search')).toBeTruthy()
  })

  it('shows completed label and summary when group is closed', () => {
    const tools = [
      toolItem('t1', 'read', 'a.ts', 'done', { startedAt: 1_000, endedAt: 7_000 }),
      toolItem('t2', 'search', 'query', 'done')
    ]
    render(<ToolGroup tools={tools} />)
    expect(screen.getByText('Explored')).toBeTruthy()
    expect(screen.getByText('1 file and 1 search')).toBeTruthy()
    expect(screen.getByText('6s')).toBeTruthy()
  })

  it('shows interrupted label without nested list', () => {
    const tools = [
      toolItem('t1', 'read', 'a.ts', 'fail', { startedAt: 1_000, endedAt: 2_000 })
    ]
    tools[0]!.tool.content = 'Cancelled'
    render(<ToolGroup tools={tools} />)
    expect(screen.getByText('Exploration interrupted')).toBeTruthy()
    expect(screen.queryByText('Explored')).toBeNull()
  })
})
