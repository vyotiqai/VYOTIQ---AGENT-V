import { describe, expect, it, beforeEach } from 'vitest'
import {
  assertToolAllowedInMode,
  askSafeAlignsWithParallelSafe,
  filterToolDefsForMode,
  isBuiltinAllowedInMode,
  isPlanArtifactPath,
  modeSectionMarkdown
} from '../../../src/main/agent/tools/modePolicy'
import { setMcpReadOnlyHintsForTests } from '../../../src/main/agent/mcp'

describe('modePolicy', () => {
  beforeEach(() => {
    setMcpReadOnlyHintsForTests({ 'mcp__srv__tool': false })
  })

  it('Ask-safe tools align with parallel-safe built-ins', () => {
    expect(askSafeAlignsWithParallelSafe()).toBe(true)
  })

  it('Ask mode denies edit and terminal', () => {
    expect(isBuiltinAllowedInMode('ask', 'edit')).toBe(false)
    expect(isBuiltinAllowedInMode('ask', 'terminal')).toBe(false)
    expect(isBuiltinAllowedInMode('ask', 'read')).toBe(true)
    expect(assertToolAllowedInMode('ask', 'edit', { path: 'a.ts', contents: 'x' }).ok).toBe(false)
  })

  it('Plan mode allows todo_write and plan.md edits only', () => {
    expect(isBuiltinAllowedInMode('plan', 'todo_write')).toBe(true)
    expect(isBuiltinAllowedInMode('plan', 'edit')).toBe(true)
    expect(assertToolAllowedInMode('plan', 'edit', { path: 'plan.md', contents: '# Plan' }).ok).toBe(
      true
    )
    expect(
      assertToolAllowedInMode('plan', 'edit', { path: 'src/app.ts', contents: 'x' }).ok
    ).toBe(false)
    expect(
      assertToolAllowedInMode('plan', 'str_replace', {
        path: 'contract.md',
        old_string: 'a',
        new_string: 'b'
      }).ok
    ).toBe(true)
    expect(assertToolAllowedInMode('plan', 'terminal', { command: 'echo' }).ok).toBe(false)
    expect(assertToolAllowedInMode('plan', 'multi_edit', { edits: [] }).ok).toBe(false)
    expect(assertToolAllowedInMode('plan', 'delete', { path: 'x' }).ok).toBe(false)
  })

  it('Agent mode allows all built-ins', () => {
    expect(isBuiltinAllowedInMode('agent', 'edit')).toBe(true)
    expect(isBuiltinAllowedInMode('agent', 'terminal')).toBe(true)
    expect(assertToolAllowedInMode('agent', 'delete', { path: 'x' }).ok).toBe(true)
  })

  it('isPlanArtifactPath recognizes plan and contract', () => {
    expect(isPlanArtifactPath('plan.md')).toBe(true)
    expect(isPlanArtifactPath('./contract.md')).toBe(true)
    expect(isPlanArtifactPath('src/plan.md')).toBe(true)
    expect(isPlanArtifactPath('src/app.ts')).toBe(false)
  })

  it('filterToolDefsForMode keeps readOnlyHint MCP in Ask and drops mutating tools', () => {
    const defs = [
      { name: 'read' },
      { name: 'edit' },
      { name: 'mcp__srv__tool' },
      { name: 'mcp__srv__write' },
      { name: 'browser_click' },
      { name: 'browser_navigate' }
    ]
    setMcpReadOnlyHintsForTests({ 'mcp__srv__tool': true, 'mcp__srv__write': false })
    const ask = filterToolDefsForMode('ask', defs)
    expect(ask.map((d) => d.name)).toEqual(['read', 'mcp__srv__tool', 'browser_navigate'])
    expect(assertToolAllowedInMode('ask', 'mcp__srv__tool', {}).ok).toBe(true)
    expect(assertToolAllowedInMode('ask', 'mcp__srv__write', {}).ok).toBe(false)
  })

  it('Ask mode denies browser_click and browser_type', () => {
    expect(isBuiltinAllowedInMode('ask', 'browser_click')).toBe(false)
    expect(isBuiltinAllowedInMode('ask', 'browser_type')).toBe(false)
    expect(isBuiltinAllowedInMode('ask', 'browser_navigate')).toBe(true)
    expect(assertToolAllowedInMode('ask', 'browser_click', { selector: 'button' }).ok).toBe(false)
  })

  it('Ask mode allows wait/history/tabs and denies press_key/select_option', () => {
    expect(isBuiltinAllowedInMode('ask', 'browser_tabs')).toBe(true)
    expect(isBuiltinAllowedInMode('ask', 'browser_back')).toBe(true)
    expect(isBuiltinAllowedInMode('ask', 'browser_forward')).toBe(true)
    expect(isBuiltinAllowedInMode('ask', 'browser_wait_for_selector')).toBe(true)
    expect(isBuiltinAllowedInMode('ask', 'browser_wait_for_url')).toBe(true)
    expect(isBuiltinAllowedInMode('ask', 'mcp_list_tools')).toBe(true)
    expect(isBuiltinAllowedInMode('ask', 'mcp_list_resources')).toBe(true)
    expect(isBuiltinAllowedInMode('ask', 'mcp_read_resource')).toBe(true)
    expect(isBuiltinAllowedInMode('ask', 'browser_press_key')).toBe(false)
    expect(isBuiltinAllowedInMode('ask', 'browser_select_option')).toBe(false)
  })

  it('modeSectionMarkdown is null for agent', () => {
    expect(modeSectionMarkdown('agent')).toBeNull()
    expect(modeSectionMarkdown('ask')).toContain('Ask mode')
    expect(modeSectionMarkdown('plan')).toContain('Plan mode')
  })
})
