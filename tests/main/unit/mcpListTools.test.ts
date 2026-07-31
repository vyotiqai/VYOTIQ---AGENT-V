import { describe, expect, it, vi, beforeEach } from 'vitest'

const listMcpToolDefinitions = vi.hoisted(() =>
  vi.fn(() => [
    {
      name: 'mcp__github__list_issues',
      description: 'list issues',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'mcp__gitlab__list_issues',
      description: 'list gitlab issues',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'mcp__github__create_issue',
      description: 'create',
      parameters: { type: 'object', properties: {} }
    }
  ])
)

vi.mock('@main/agent/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/mcp')>()
  return {
    ...actual,
    listMcpToolDefinitions: (...args: unknown[]) => listMcpToolDefinitions(...args),
    getMcpReadOnlyHint: () => undefined
  }
})

import { executeTool } from '@main/agent/tools'

describe('mcp_list_tools filtering', () => {
  beforeEach(() => {
    listMcpToolDefinitions.mockClear()
  })

  it('filters by parsed serverId equality, not substring of full tool name', async () => {
    // Substring "git" would wrongly match both github and gitlab tool names.
    const result = await executeTool(
      'mcp_list_tools',
      JSON.stringify({ serverId: 'github' }),
      '/tmp/ws',
      new AbortController().signal,
      { runEnabledMcpIds: new Set(['github', 'gitlab']) }
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('mcp__github__list_issues')
    expect(result.content).toContain('mcp__github__create_issue')
    expect(result.content).not.toContain('mcp__gitlab__')
  })

  it('lists connected tools and marks those omitted from the step catalog', async () => {
    const result = await executeTool(
      'mcp_list_tools',
      '{}',
      '/tmp/ws',
      new AbortController().signal,
      {
        runEnabledMcpIds: new Set(['github', 'gitlab']),
        stepMcpToolNames: new Set(['mcp__github__list_issues'])
      }
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('mcp__github__list_issues')
    expect(result.content).toContain('mcp__github__create_issue')
    expect(result.content).toContain('[omitted from this step catalog]')
    expect(result.content).toContain('mcp__gitlab__list_issues')
  })

  it('pins tools for the next step via request_mcp_tools', async () => {
    const pinned = new Set<string>()
    let invalidated = false
    const result = await executeTool(
      'request_mcp_tools',
      JSON.stringify({ tools: ['mcp__github__create_issue'] }),
      '/tmp/ws',
      new AbortController().signal,
      {
        runEnabledMcpIds: new Set(['github', 'gitlab']),
        runPinnedMcpToolNames: pinned,
        invalidateMcpToolCatalogCache: () => {
          invalidated = true
        }
      }
    )
    expect(result.ok).toBe(true)
    expect(pinned.has('mcp__github__create_issue')).toBe(true)
    expect(invalidated).toBe(true)
  })
})
