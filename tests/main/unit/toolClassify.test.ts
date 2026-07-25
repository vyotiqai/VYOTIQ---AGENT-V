import { describe, expect, it } from 'vitest'
import { isReadOnlyTool } from '@main/agent/tools/classify'

describe('tool classify', () => {
  it('marks built-in read tools as parallel-safe', () => {
    expect(isReadOnlyTool('read')).toBe(true)
    expect(isReadOnlyTool('search')).toBe(true)
    expect(isReadOnlyTool('memory_read')).toBe(true)
  })

  it('marks mutating built-in tools as serial-only', () => {
    expect(isReadOnlyTool('edit')).toBe(false)
    expect(isReadOnlyTool('terminal')).toBe(false)
    expect(isReadOnlyTool('memory_write')).toBe(false)
  })

  it('heuristically classifies MCP tools by name', () => {
    expect(isReadOnlyTool('mcp__fs__read_file')).toBe(true)
    expect(isReadOnlyTool('mcp__gh__create_issue')).toBe(false)
  })
})
