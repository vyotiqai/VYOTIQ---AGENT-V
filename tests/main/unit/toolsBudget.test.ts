import { describe, expect, it } from 'vitest'
import { trimToolsToBudget } from '@main/agent/context/toolsBudget'
import type { ToolDefinition } from '@main/agent/providers/types'

function tool(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {} }
  }
}

describe('trimToolsToBudget', () => {
  it('keeps all built-in tools even when budget is tight', () => {
    const builtins = [
      tool('read', 'read files'),
      tool('edit', 'edit files'),
      tool('search', 'search files')
    ]
    const result = trimToolsToBudget(builtins, 50)
    expect(result.tools.map((t) => t.name)).toEqual(['read', 'edit', 'search'])
  })

  it('drops MCP tools when over budget', () => {
    const tools = [
      tool('read', 'read'),
      tool('mcp__a__one', 'x'.repeat(500)),
      tool('mcp__b__two', 'y'.repeat(500))
    ]
    const result = trimToolsToBudget(tools, 50)
    expect(result.tools.some((t) => t.name.startsWith('mcp__'))).toBe(false)
    expect(result.omittedMcp).toBeGreaterThan(0)
  })

  it('does not pin code-review-graph ahead of smaller MCP tools', () => {
    const builtins = [tool('read', 'r')]
    const small = tool('mcp__other__small', 's')
    const bigGraph = tool('mcp__code-review-graph__big', 'G'.repeat(4000))
    const base = trimToolsToBudget(builtins, 1_000_000).estimate
    const withSmall = trimToolsToBudget([...builtins, small], 1_000_000).estimate
    // Budget that fits builtins + small fully, but leaves almost no room for another MCP.
    const budget = withSmall + 1
    const result = trimToolsToBudget([...builtins, bigGraph, small], budget)
    const keptMcp = result.tools.filter((t) => t.name.startsWith('mcp__')).map((t) => t.name)
    expect(keptMcp).toEqual(['mcp__other__small'])
    expect(result.omittedMcpNames).toContain('mcp__code-review-graph__big')
    // Sanity: under the old pin, a larger graph tool would have been considered first.
    expect(base).toBeLessThan(withSmall)
  })

  it('prefers pinned MCP tools over smaller unpinned ones', () => {
    const builtins = [tool('read', 'r')]
    const small = tool('mcp__other__small', 's')
    const pinnedBig = tool('mcp__pin__big', 'P'.repeat(2000))
    const base = trimToolsToBudget(builtins, 1_000_000).estimate
    const withSmall = trimToolsToBudget([...builtins, small], 1_000_000).estimate
    const smallCost = withSmall - base
    const budget = base + smallCost + 50
    const result = trimToolsToBudget([...builtins, small, pinnedBig], budget, {
      pinnedMcpNames: new Set(['mcp__pin__big'])
    })
    expect(result.tools.map((t) => t.name)).toContain('mcp__pin__big')
  })
})
