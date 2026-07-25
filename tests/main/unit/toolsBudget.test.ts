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
})
