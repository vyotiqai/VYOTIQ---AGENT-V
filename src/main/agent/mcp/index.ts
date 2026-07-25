import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpServer } from '../../../shared/ipc'
import type { McpServerStatus } from '../../../shared/ipc'
import type { ToolDefinition } from '../providers/types'
import { logger } from '../../../shared/logger'
import { formatError, isAbortError } from '../../../shared/errors'
import { mcpToolSummary } from '../../../shared/toolSummary'
import type { ToolResult } from '../tools'

export const MCP_TOOL_PREFIX = 'mcp__'

export function mcpToolName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverId}__${toolName}`
}

export function parseMcpToolName(
  name: string
): { serverId: string; toolName: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null
  const rest = name.slice(MCP_TOOL_PREFIX.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return null
  return { serverId: rest.slice(0, sep), toolName: rest.slice(sep + 2) }
}

type McpSession = {
  client: Client
  transport: StdioClientTransport
  tools: ToolDefinition[]
}

const sessions = new Map<string, McpSession>()
const connectErrors = new Map<string, string>()
const sessionConfigKeys = new Map<string, string>()

/** Stable fingerprint of connection-relevant MCP server fields. */
export function mcpServerConfigKey(server: Pick<McpServer, 'command' | 'args' | 'env'>): string {
  const env = server.env ?? {}
  const envEntries = Object.keys(env)
    .sort()
    .map((key) => [key, env[key] ?? ''] as const)
  return JSON.stringify({
    command: server.command,
    args: server.args ?? [],
    env: envEntries
  })
}

export function validateMcpServers(servers: McpServer[]): string | null {
  const seen = new Set<string>()
  for (const server of servers) {
    if (seen.has(server.id)) return `Duplicate MCP server id: ${server.id}`
    seen.add(server.id)
  }
  return null
}

export function getMcpServerStatus(servers: McpServer[]): McpServerStatus[] {
  return servers.map((server) => {
    const error = connectErrors.get(server.id)
    return {
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      connected: sessions.has(server.id),
      toolCount: sessions.get(server.id)?.tools.length ?? 0,
      ...(error ? { error } : {})
    }
  })
}

export async function refreshMcpServers(servers: McpServer[]): Promise<McpServerStatus[]> {
  await syncMcpServers(servers)
  return getMcpServerStatus(servers)
}

export async function connectMcpServer(server: McpServer): Promise<void> {
  if (sessions.has(server.id)) return
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: Object.fromEntries(
      Object.entries({ ...process.env, ...server.env }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    )
  })
  const client = new Client({ name: 'vyotiq', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  const listed = await client.listTools()
  const tools: ToolDefinition[] = (listed.tools ?? []).map((t) => ({
    name: mcpToolName(server.id, t.name),
    description: t.description ?? `MCP tool ${t.name} (${server.name})`,
    parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} }
  }))
  sessions.set(server.id, { client, transport, tools })
  sessionConfigKeys.set(server.id, mcpServerConfigKey(server))
  connectErrors.delete(server.id)
  logger.info('MCP server connected', {
    scope: 'mcp',
    serverId: server.id,
    toolCount: tools.length
  })
}

export async function disconnectMcpServer(serverId: string): Promise<void> {
  const session = sessions.get(serverId)
  if (!session) return
  try {
    await session.client.close()
  } catch {
    // ignore
  }
  sessions.delete(serverId)
  sessionConfigKeys.delete(serverId)
  connectErrors.delete(serverId)
}

export async function syncMcpServers(servers: McpServer[]): Promise<void> {
  const duplicateError = validateMcpServers(servers)
  if (duplicateError) {
    throw new Error(duplicateError)
  }

  const enabled = servers.filter((s) => s.enabled)
  const enabledIds = new Set(enabled.map((s) => s.id))
  for (const id of [...sessions.keys()]) {
    if (!enabledIds.has(id)) await disconnectMcpServer(id)
  }
  for (const server of enabled) {
    const configKey = mcpServerConfigKey(server)
    const connectedKey = sessionConfigKeys.get(server.id)
    if (sessions.has(server.id) && connectedKey !== configKey) {
      await disconnectMcpServer(server.id)
    }
    if (!sessions.has(server.id)) {
      try {
        await connectMcpServer(server)
      } catch (err) {
        connectErrors.set(server.id, formatError(err))
        logger.warn('MCP connect failed', {
          scope: 'mcp',
          serverId: server.id,
          err
        })
      }
    }
  }
}

export function listMcpToolDefinitions(): ToolDefinition[] {
  const out: ToolDefinition[] = []
  for (const session of sessions.values()) {
    out.push(...session.tools)
  }
  return out
}

export async function invokeMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  fullToolName?: string
): Promise<ToolResult> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const summary = mcpToolSummary(toolName, args)
  const session = sessions.get(serverId)
  if (!session) {
    return { ok: false, summary, content: `MCP server not connected: ${serverId}` }
  }
  try {
    const result = await session.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { signal }
    )
    const text = (result.content as Array<{ type?: string; text?: string }>)
      .map((c) => (c.type === 'text' ? c.text ?? '' : JSON.stringify(c)))
      .join('\n')
      .slice(0, 100_000)
    const ok = result.isError !== true
    const prefix = ok ? '' : `[MCP ${fullToolName ?? toolName} error]\n`
    return { ok, summary, content: prefix + (text || '(empty)') }
  } catch (err) {
    if (signal.aborted || isAbortError(err)) {
      throw new DOMException('Aborted', 'AbortError')
    }
    return { ok: false, summary, content: formatError(err) }
  }
}

export async function shutdownMcpServers(): Promise<void> {
  for (const id of [...sessions.keys()]) {
    await disconnectMcpServer(id)
  }
}

/** Test helper */
export function resetMcpSessionsForTests(): void {
  sessions.clear()
  connectErrors.clear()
  sessionConfigKeys.clear()
}

/** Test helper — connected MCP server ids. */
export function listConnectedMcpServerIdsForTests(): string[] {
  return [...sessions.keys()]
}
