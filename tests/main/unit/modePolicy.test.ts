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

  it('filterToolDefsForMode drops mutating tools in Ask', () => {
    const defs = [
      { name: 'read' },
      { name: 'edit' },
      { name: 'mcp__srv__tool' }
    ]
    setMcpReadOnlyHintsForTests({ 'mcp__srv__tool': true })
    const ask = filterToolDefsForMode('ask', defs)
    expect(ask.map((d) => d.name)).toEqual(['read', 'mcp__srv__tool'])
    setMcpReadOnlyHintsForTests({ 'mcp__srv__tool': false })
    expect(filterToolDefsForMode('ask', defs).map((d) => d.name)).toEqual(['read'])
  })

  it('modeSectionMarkdown is null for agent', () => {
    expect(modeSectionMarkdown('agent')).toBeNull()
    expect(modeSectionMarkdown('ask')).toContain('Ask mode')
    expect(modeSectionMarkdown('plan')).toContain('Plan mode')
  })
})
