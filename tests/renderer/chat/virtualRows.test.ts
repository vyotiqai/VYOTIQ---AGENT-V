import { describe, expect, it } from 'vitest'
import { buildVirtualRows, estimateVirtualRowSize } from '@renderer/features/chat/utils/virtualRows'
import type { UiItem } from '@shared/transcript'

function tool(id: string, expanded = false): UiItem {
  return {
    kind: 'tool',
    id,
    toolExpanded: expanded,
    tool: { id, name: 'read', summary: id, status: 'done' }
  }
}

describe('buildVirtualRows', () => {
  it('keeps single tools and messages as single rows', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'm1', role: 'assistant', content: 'hi' },
      tool('t1')
    ]
    const rows = buildVirtualRows(items)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.kind).toBe('single')
    expect(rows[1]?.kind).toBe('single')
  })

  it('groups consecutive tool rows into one virtual row', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'm1', role: 'assistant', content: 'go' },
      tool('t1'),
      tool('t2'),
      tool('t3'),
      { kind: 'message', id: 'm2', role: 'assistant', content: 'done' }
    ]
    const rows = buildVirtualRows(items)
    expect(rows).toHaveLength(3)
    expect(rows[1]?.kind).toBe('tool-group')
    if (rows[1]?.kind === 'tool-group') {
      expect(rows[1].tools).toHaveLength(3)
    }
  })

  it('splits tool groups when assistant text interrupts', () => {
    const items: UiItem[] = [tool('a1'), tool('a2'), { kind: 'message', id: 'm', role: 'assistant', content: 'x' }, tool('b1')]
    const rows = buildVirtualRows(items)
    expect(rows).toHaveLength(3)
    expect(rows[0]?.kind).toBe('tool-group')
    expect(rows[1]?.kind).toBe('single')
    expect(rows[2]?.kind).toBe('single')
  })

  it('accounts for expanded tools inside grouped virtual rows', () => {
    const rows = buildVirtualRows([tool('t1'), tool('t2', true)])
    expect(rows[0]?.kind).toBe('tool-group')
    if (rows[0]?.kind === 'tool-group') {
      const collapsed = estimateVirtualRowSize({
        kind: 'tool-group',
        id: 'g',
        tools: [tool('t1'), tool('t2')]
      })
      const expanded = estimateVirtualRowSize(rows[0])
      expect(expanded).toBeGreaterThan(collapsed)
    }
  })

  it('estimates collapsed tool-group smaller than expanded group', () => {
    const group = {
      kind: 'tool-group' as const,
      id: 'g',
      tools: [tool('t1'), tool('t2'), tool('t3')]
    }
    const collapsed = estimateVirtualRowSize(group)
    const expanded = estimateVirtualRowSize({
      ...group,
      tools: [tool('t1', true), tool('t2'), tool('t3')]
    })
    expect(collapsed).toBeLessThan(expanded)
  })
})
