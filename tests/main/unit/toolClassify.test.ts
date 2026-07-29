import { afterEach, describe, expect, it } from 'vitest'
import { resetMcpSessionsForTests, setMcpReadOnlyHintsForTests } from '@main/agent/mcp'
import {
  isApprovalExemptTool,
  isParallelSafeTool,
  isReadOnlyTool
} from '@main/agent/tools/classify'
import { isToolGated } from '@main/agent/toolApproval'

afterEach(() => {
  resetMcpSessionsForTests()
})

describe('tool classify', () => {
  it('marks built-in parallel-safe tools', () => {
    expect(isParallelSafeTool('read')).toBe(true)
    expect(isParallelSafeTool('search')).toBe(true)
    expect(isParallelSafeTool('glob')).toBe(true)
    expect(isParallelSafeTool('grep')).toBe(true)
    expect(isParallelSafeTool('list_dir')).toBe(true)
    expect(isParallelSafeTool('web_fetch')).toBe(true)
    expect(isParallelSafeTool('memory_read')).toBe(true)
    expect(isParallelSafeTool('subagent')).toBe(true)
    expect(isReadOnlyTool('read')).toBe(true)
  })

  it('marks mutating built-in tools as serial-only', () => {
    expect(isParallelSafeTool('edit')).toBe(false)
    expect(isParallelSafeTool('terminal')).toBe(false)
    expect(isParallelSafeTool('memory_write')).toBe(false)
  })

  it('gates web_fetch for approval while keeping it parallel-safe', () => {
    expect(isParallelSafeTool('web_fetch')).toBe(true)
    expect(isApprovalExemptTool('web_fetch')).toBe(false)
    expect(isApprovalExemptTool('read')).toBe(true)
    expect(isToolGated('web_fetch', 'mutating', new Set(), [])).toBe(true)
    expect(isToolGated('read', 'mutating', new Set(), [])).toBe(false)
  })

  it('gates web_search like web_fetch', () => {
    expect(isParallelSafeTool('web_search')).toBe(true)
    expect(isApprovalExemptTool('web_search')).toBe(false)
    expect(isToolGated('web_search', 'mutating', new Set(), [])).toBe(true)
  })

  it('serializes browser tools on the shared window and gates approval', () => {
    expect(isParallelSafeTool('browser_navigate')).toBe(false)
    expect(isParallelSafeTool('browser_snapshot')).toBe(false)
    expect(isApprovalExemptTool('browser_navigate')).toBe(false)
    expect(isApprovalExemptTool('browser_snapshot')).toBe(false)
    expect(isToolGated('browser_navigate', 'mutating', new Set(), [])).toBe(true)
    expect(isToolGated('browser_snapshot', 'mutating', new Set(), [])).toBe(true)
  })

  it('treats MCP tools as untrusted regardless of readOnlyHint', () => {
    expect(isParallelSafeTool('mcp__fs__read_file')).toBe(false)
    expect(isApprovalExemptTool('mcp__fs__read_file')).toBe(false)
    expect(isParallelSafeTool('mcp__gh__create_issue')).toBe(false)
    setMcpReadOnlyHintsForTests({ 'mcp__fs__read_file': true })
    expect(isParallelSafeTool('mcp__fs__read_file')).toBe(false)
    expect(isApprovalExemptTool('mcp__fs__read_file')).toBe(false)
    expect(isToolGated('mcp__fs__read_file', 'mutating', new Set(), [])).toBe(true)
  })
})
