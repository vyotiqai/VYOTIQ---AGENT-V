import { describe, expect, it, afterEach } from 'vitest'
import { join } from 'path'
import { fileURLToPath } from 'url'
import {
  connectMcpServer,
  disconnectMcpServer,
  invokeMcpTool,
  listConnectedMcpServerIdsForTests,
  listMcpToolDefinitions,
  mcpToolName,
  getMcpServerStatus,
  resetMcpSessionsForTests,
  shutdownMcpServers,
  syncMcpServers,
  buildMcpChildEnv
} from '@main/agent/mcp'
import { executeTool } from '@main/agent/tools'

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), '../../fixtures/mcp-echo-server.mjs')
const slowFixturePath = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../fixtures/mcp-slow-echo-server.mjs'
)

const echoServer = {
  id: 'echo',
  name: 'Echo Fixture',
  enabled: true,
  transport: 'stdio' as const,
  command: process.execPath,
  args: [fixturePath],
  env: {}
}

describe('MCP stdio integration', () => {
  afterEach(async () => {
    await shutdownMcpServers()
    resetMcpSessionsForTests()
  })

  it('scrubs parent API keys from MCP child env unless opted in via server.env', () => {
    const env = buildMcpChildEnv(
      { CUSTOM_OK: '1' },
      {
        PATH: '/usr/bin',
        OPENAI_API_KEY: 'sk-secret',
        ANTHROPIC_API_KEY: 'sk-anth',
        CUSTOM_OK: 'from-parent'
      }
    )
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.CUSTOM_OK).toBe('1')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('connects, lists tools, invokes echo, and disconnects', async () => {
    await connectMcpServer(echoServer)

    const tools = listMcpToolDefinitions()
    expect(tools.some((t) => t.name === mcpToolName('echo', 'echo'))).toBe(true)

    const result = await invokeMcpTool(
      'echo',
      'echo',
      { message: 'hello-mcp' },
      new AbortController().signal
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('hello-mcp')

    await disconnectMcpServer('echo')
    const after = await invokeMcpTool('echo', 'echo', {}, new AbortController().signal)
    expect(after.ok).toBe(false)
    expect(after.content).toMatch(/not connected/i)
  })

  it('routes namespaced MCP tools through executeTool', async () => {
    await connectMcpServer(echoServer)

    const name = mcpToolName('echo', 'echo')
    const result = await executeTool(
      name,
      JSON.stringify({ message: 'via-executeTool' }),
      '/tmp',
      new AbortController().signal
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('via-executeTool')
  })

  it('rejects MCP tool args that fail the server inputSchema locally', async () => {
    await connectMcpServer(echoServer)
    const name = mcpToolName('echo', 'echo')
    const result = await executeTool(
      name,
      JSON.stringify({ message: 123 }),
      '/tmp',
      new AbortController().signal
    )
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/string|message/i)
  })

  it('aborts in-flight MCP tool calls when the run signal is cancelled', async () => {
    await connectMcpServer({
      id: 'slow',
      name: 'Slow Echo',
      enabled: true,
      command: process.execPath,
      args: [slowFixturePath]
    })

    const controller = new AbortController()
    const invokePromise = invokeMcpTool(
      'slow',
      'slow_echo',
      { message: 'too-slow' },
      controller.signal
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    controller.abort()

    await expect(invokePromise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('syncMcpServers', () => {
  afterEach(async () => {
    await shutdownMcpServers()
    resetMcpSessionsForTests()
  })

  it('connects enabled servers and exposes their tools', async () => {
    await syncMcpServers([echoServer])
    expect(listConnectedMcpServerIdsForTests()).toEqual(['echo'])
    expect(listMcpToolDefinitions().some((t) => t.name === mcpToolName('echo', 'echo'))).toBe(
      true
    )
  })

  it('disconnects servers removed from the enabled set', async () => {
    await syncMcpServers([echoServer])
    await syncMcpServers([{ ...echoServer, enabled: false }])
    expect(listConnectedMcpServerIdsForTests()).toEqual([])
    expect(listMcpToolDefinitions()).toEqual([])
  })

  it('is idempotent for already-connected servers', async () => {
    await syncMcpServers([echoServer])
    await syncMcpServers([echoServer])
    expect(listConnectedMcpServerIdsForTests()).toEqual(['echo'])
    const result = await invokeMcpTool(
      'echo',
      'echo',
      { message: 'still-up' },
      new AbortController().signal
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('still-up')
  })

  it('survives connect failures without leaving partial sessions', async () => {
    await syncMcpServers([
      {
        id: 'bad',
        name: 'Bad',
        enabled: true,
        command: 'vyotiq-nonexistent-mcp-command',
        args: []
      }
    ])
    expect(listConnectedMcpServerIdsForTests()).toEqual([])
    expect(listMcpToolDefinitions()).toEqual([])
  })

  it('reports connect errors via getMcpServerStatus', async () => {
    await syncMcpServers([
      {
        id: 'bad',
        name: 'Bad',
        enabled: true,
        command: 'vyotiq-nonexistent-mcp-command',
        args: []
      }
    ])
    const status = getMcpServerStatus([
      {
        id: 'bad',
        name: 'Bad',
        enabled: true,
        command: 'vyotiq-nonexistent-mcp-command',
        args: []
      }
    ])
    expect(status[0]?.connected).toBe(false)
    expect(status[0]?.error).toBeTruthy()
  })

  it('reconnects when connection config changes', async () => {
    await syncMcpServers([echoServer])
    const before = listMcpToolDefinitions().length
    expect(before).toBeGreaterThan(0)

    const updated = {
      ...echoServer,
      args: [fixturePath, '--prefix', 'changed']
    }
    await syncMcpServers([updated])
    expect(listConnectedMcpServerIdsForTests()).toEqual(['echo'])
    expect(listMcpToolDefinitions().length).toBeGreaterThan(0)

    const result = await invokeMcpTool(
      'echo',
      'echo',
      { message: 'reconnect-ok' },
      new AbortController().signal
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('reconnect-ok')
  })

  it('rejects duplicate server ids', async () => {
    await expect(
      syncMcpServers([
        echoServer,
        { ...echoServer, name: 'Echo duplicate' }
      ])
    ).rejects.toThrow(/duplicate mcp server id/i)
  })
})
