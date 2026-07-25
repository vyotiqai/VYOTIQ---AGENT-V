import { describe, expect, it } from 'vitest'
import { mcpToolName, parseMcpToolName } from '@main/agent/mcp'

describe('MCP tool naming', () => {
  it('namespaces tools by server id', () => {
    expect(mcpToolName('fs', 'read_file')).toBe('mcp__fs__read_file')
  })

  it('parses namespaced tool names', () => {
    expect(parseMcpToolName('mcp__fs__read_file')).toEqual({
      serverId: 'fs',
      toolName: 'read_file'
    })
  })

  it('returns null for built-in tools', () => {
    expect(parseMcpToolName('read')).toBeNull()
  })
})
