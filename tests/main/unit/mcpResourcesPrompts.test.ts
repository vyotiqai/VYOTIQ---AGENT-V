import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerMcpSessionForTests,
  resetMcpSessionsForTests
} from '@main/agent/mcp'
import { executeTool } from '@main/agent/tools'
import { isApprovalExemptTool, isParallelSafeTool } from '@main/agent/tools/classify'
import { isBuiltinAllowedInMode } from '@main/agent/tools/modePolicy'

function mockClient(overrides: {
  listResources?: ReturnType<typeof vi.fn>
  readResource?: ReturnType<typeof vi.fn>
  listPrompts?: ReturnType<typeof vi.fn>
  getPrompt?: ReturnType<typeof vi.fn>
}) {
  return {
    listTools: vi.fn(async () => ({ tools: [] })),
    listResources:
      overrides.listResources ??
      vi.fn(async () => ({
        resources: [{ uri: 'file:///notes.md', name: 'Notes', description: 'Scratch pad' }]
      })),
    readResource:
      overrides.readResource ??
      vi.fn(async () => ({ contents: [{ type: 'text', text: 'hello resource' }] })),
    listPrompts:
      overrides.listPrompts ??
      vi.fn(async () => ({
        prompts: [{ name: 'summarize', description: 'Summarize text', arguments: [{ name: 'text' }] }]
      })),
    getPrompt:
      overrides.getPrompt ??
      vi.fn(async () => ({
        description: 'Summarize prompt',
        messages: [{ role: 'user', content: { type: 'text', text: 'Summarize this.' } }]
      })),
    getServerCapabilities: vi.fn(() => ({ resources: {}, prompts: {} })),
    close: vi.fn(async () => undefined)
  }
}

describe('MCP resource/prompt built-ins', () => {
  afterEach(() => {
    resetMcpSessionsForTests()
  })

  it('lists resources from a connected server', async () => {
    const client = mockClient({})
    registerMcpSessionForTests('docs', client)

    const result = await executeTool(
      'mcp_list_resources',
      JSON.stringify({ serverId: 'docs' }),
      '/tmp/ws',
      new AbortController().signal,
      { runEnabledMcpIds: new Set(['docs']) }
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('file:///notes.md')
    expect(client.listResources).toHaveBeenCalled()
  })

  it('reads a resource by server id and uri', async () => {
    const client = mockClient({})
    registerMcpSessionForTests('docs', client)

    const result = await executeTool(
      'mcp_read_resource',
      JSON.stringify({ serverId: 'docs', uri: 'file:///notes.md' }),
      '/tmp/ws',
      new AbortController().signal,
      { runEnabledMcpIds: new Set(['docs']) }
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('hello resource')
    expect(client.readResource).toHaveBeenCalledWith(
      { uri: 'file:///notes.md' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('lists prompts from a connected server', async () => {
    const client = mockClient({})
    registerMcpSessionForTests('docs', client)

    const result = await executeTool(
      'mcp_list_prompts',
      JSON.stringify({ serverId: 'docs' }),
      '/tmp/ws',
      new AbortController().signal,
      { runEnabledMcpIds: new Set(['docs']) }
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('summarize')
    expect(client.listPrompts).toHaveBeenCalled()
  })

  it('fetches a prompt with arguments', async () => {
    const client = mockClient({})
    registerMcpSessionForTests('docs', client)

    const result = await executeTool(
      'mcp_get_prompt',
      JSON.stringify({ serverId: 'docs', name: 'summarize', arguments: { text: 'hello' } }),
      '/tmp/ws',
      new AbortController().signal,
      { runEnabledMcpIds: new Set(['docs']) }
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('Summarize this.')
    expect(client.getPrompt).toHaveBeenCalledWith(
      { name: 'summarize', arguments: { text: 'hello' } },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('rejects when the server is not connected', async () => {
    const result = await executeTool(
      'mcp_read_resource',
      JSON.stringify({ serverId: 'missing', uri: 'file:///x' }),
      '/tmp/ws',
      new AbortController().signal,
      { runEnabledMcpIds: new Set(['missing']) }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/not connected/i)
  })

  it('rejects when the server is not enabled for the run', async () => {
    registerMcpSessionForTests('docs', mockClient({}))

    const result = await executeTool(
      'mcp_read_resource',
      JSON.stringify({ serverId: 'docs', uri: 'file:///notes.md' }),
      '/tmp/ws',
      new AbortController().signal,
      { runEnabledMcpIds: new Set(['other']) }
    )

    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/not enabled for this workspace run/i)
  })

  it('treats MCP resource/prompt tools as serial and approval-exempt', () => {
    for (const name of [
      'mcp_list_resources',
      'mcp_read_resource',
      'mcp_list_prompts',
      'mcp_get_prompt'
    ]) {
      expect(isParallelSafeTool(name)).toBe(false)
      expect(isApprovalExemptTool(name)).toBe(true)
      expect(isBuiltinAllowedInMode('ask', name)).toBe(true)
    }
  })
})
