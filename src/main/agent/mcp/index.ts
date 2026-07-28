import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServer } from '../../../shared/ipc'
import type { McpServerStatus } from '../../../shared/ipc'
import type { ToolDefinition } from '../providers/types'
import { logger } from '../../../shared/logger'
import { formatError, isAbortError } from '../../../shared/errors'
import { mcpToolSummary } from '../../../shared/toolSummary'
import type { ToolResult } from '../tools'
import { sanitizedTerminalEnv } from '../tools/terminal'
import {
  getMcpAuthToken,
  hasMcpAuthToken,
  hasMcpOAuthState,
  setMcpAuthToken,
  clearMcpOAuthState
} from '../../settings/secrets'
import { getSettings, setSettings } from '../../settings/settings'
import {
  getBearerToken,
  headersWithoutAuthorization,
  withBearerToken
} from '../../../shared/utils/mcpAuth'
import {
  beginMcpOAuthCallback,
  cancelMcpOAuthCallback,
  createMcpOAuthProvider
} from './oauth'
import { resolveEffectiveMcpServers } from '../../marketplace/resolve'

/** Scrubbed base env + optional user-configured MCP server.env overlays. */
export function buildMcpChildEnv(
  serverEnv?: Record<string, string>,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = { ...sanitizedTerminalEnv(source) }
  for (const [key, value] of Object.entries(serverEnv ?? {})) {
    if (typeof value === 'string') env[key] = value
  }
  return env
}

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
  transport: Transport
  tools: ToolDefinition[]
}

const sessions = new Map<string, McpSession>()
const connectErrors = new Map<string, string>()
const sessionConfigKeys = new Map<string, string>()
const mcpReadOnlyHints = new Map<string, boolean>()

/** True only when the MCP server declared readOnlyHint for this tool. */
export function getMcpReadOnlyHint(name: string): boolean | undefined {
  return mcpReadOnlyHints.get(name)
}

function sortedRecordEntries(record?: Record<string, string>): Array<[string, string]> {
  const env = record ?? {}
  return Object.keys(env)
    .sort()
    .map((key) => [key, env[key] ?? ''] as const)
}

/** Stable fingerprint of connection-relevant MCP server fields. */
export function mcpServerConfigKey(
  server: Pick<McpServer, 'transport' | 'command' | 'args' | 'env' | 'url' | 'headers'> & {
    id?: string
  }
): string {
  const transport = server.transport ?? 'stdio'
  // Auth secrets only apply to remote transports; skip for stdio (also keeps unit tests
  // that don't mock Electron from touching safeStorage).
  const authPresent =
    server.id && (transport === 'http' || transport === 'sse')
      ? hasMcpAuthToken(server.id) || hasMcpOAuthState(server.id)
      : false
  return JSON.stringify({
    transport,
    command: server.command ?? '',
    args: server.args ?? [],
    env: sortedRecordEntries(server.env),
    url: server.url ?? '',
    // Never fingerprint secret token values — only presence + non-auth headers.
    headers: sortedRecordEntries(headersWithoutAuthorization(server.headers)),
    authPresent
  })
}

/**
 * Resolve request headers for remote MCP: non-secret headers from settings plus
 * Bearer token from OS secure storage (wins over any leftover Authorization).
 */
export function resolveMcpRequestHeaders(
  server: Pick<McpServer, 'id' | 'headers'>
): Record<string, string> | undefined {
  const base = headersWithoutAuthorization(server.headers)
  const token = getMcpAuthToken(server.id)
  if (token) return withBearerToken(base, token)
  return base && Object.keys(base).length > 0 ? base : undefined
}

/**
 * If settings still hold a plaintext Bearer token, migrate it into safeStorage
 * and return headers with Authorization removed. Caller should persist when changed.
 */
export function migratePlaintextMcpBearer(
  server: McpServer
): { server: McpServer; migrated: boolean } {
  const bearer = getBearerToken(server.headers)
  if (!bearer) return { server, migrated: false }
  if (!hasMcpAuthToken(server.id)) {
    try {
      setMcpAuthToken(server.id, bearer)
    } catch (err) {
      logger.warn('Could not migrate MCP bearer to secure storage', {
        scope: 'mcp',
        serverId: server.id,
        err
      })
      return { server, migrated: false }
    }
  }
  const nextHeaders = headersWithoutAuthorization(server.headers)
  return {
    server: { ...server, headers: nextHeaders },
    migrated: true
  }
}

export function validateMcpServers(servers: McpServer[]): string | null {
  const seen = new Set<string>()
  for (const server of servers) {
    if (server.id.includes('__')) {
      return `MCP server id must not contain "__": ${server.id}`
    }
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
      hasAuthToken: hasMcpAuthToken(server.id) || hasMcpOAuthState(server.id),
      ...(error ? { error } : {})
    }
  })
}

export async function refreshMcpServers(servers: McpServer[]): Promise<McpServerStatus[]> {
  // Force reconnect so dead stdio/HTTP sessions are recovered (sync alone skips existing entries).
  for (const id of [...sessions.keys()]) {
    await disconnectMcpServer(id)
  }
  await syncMcpServers(servers)
  return getMcpServerStatus(servers)
}

function createTransport(
  server: McpServer,
  opts?: { authProvider?: ReturnType<typeof createMcpOAuthProvider> }
): Transport {
  const transport = server.transport ?? 'stdio'
  if (transport === 'stdio') {
    const command = (server.command ?? '').trim()
    if (!command) throw new Error(`MCP server ${server.id}: command required for stdio`)
    const env = buildMcpChildEnv(server.env)
    return new StdioClientTransport({
      command,
      args: server.args ?? [],
      env
    })
  }

  const urlRaw = (server.url ?? '').trim()
  if (!urlRaw) throw new Error(`MCP server ${server.id}: url required for ${transport}`)
  const url = new URL(urlRaw)

  // Static Bearer takes precedence. With OAuth authProvider, do not set Authorization
  // via requestInit (SDK docs: headers + authProvider conflict).
  if (opts?.authProvider) {
    const base = headersWithoutAuthorization(server.headers)
    const requestInit = base && Object.keys(base).length > 0 ? { headers: base } : undefined
    if (transport === 'http') {
      return new StreamableHTTPClientTransport(url, {
        requestInit,
        authProvider: opts.authProvider
      })
    }
    return new SSEClientTransport(url, {
      requestInit,
      authProvider: opts.authProvider
    })
  }

  const headers = resolveMcpRequestHeaders(server)
  const requestInit = headers ? { headers } : undefined

  if (transport === 'http') {
    return new StreamableHTTPClientTransport(url, { requestInit })
  }
  return new SSEClientTransport(url, { requestInit })
}

async function connectWithOptionalOAuth(server: McpServer): Promise<{
  client: Client
  transport: Transport
}> {
  const transportKind = server.transport ?? 'stdio'
  if (transportKind === 'stdio' || hasMcpAuthToken(server.id)) {
    const transport = createTransport(server)
    const client = new Client({ name: 'vyotiq', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)
    return { client, transport }
  }

  // Prefer stored OAuth tokens via authProvider; otherwise try unauthenticated first.
  if (hasMcpOAuthState(server.id)) {
    return connectRemoteWithOAuth(server)
  }

  try {
    const transport = createTransport(server)
    const client = new Client({ name: 'vyotiq', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)
    return { client, transport }
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err
    logger.info('MCP server requires OAuth — starting browser flow', {
      scope: 'mcp',
      serverId: server.id
    })
    return connectRemoteWithOAuth(server)
  }
}

async function connectRemoteWithOAuth(server: McpServer): Promise<{
  client: Client
  transport: Transport
}> {
  const { redirectUrl, waitForCode } = await beginMcpOAuthCallback(server.id)
  const authProvider = createMcpOAuthProvider(server.id, redirectUrl)
  const transport = createTransport(server, { authProvider })
  const client = new Client({ name: 'vyotiq', version: '1.0.0' }, { capabilities: {} })

  try {
    await client.connect(transport)
    cancelMcpOAuthCallback(server.id)
    return { client, transport }
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) {
      cancelMcpOAuthCallback(server.id)
      try {
        await client.close()
      } catch {
        // ignore
      }
      throw err
    }

    logger.info('MCP OAuth required — waiting for browser callback', {
      scope: 'mcp',
      serverId: server.id
    })
    try {
      const code = await waitForCode()
      if ('finishAuth' in transport && typeof transport.finishAuth === 'function') {
        await (
          transport as StreamableHTTPClientTransport | SSEClientTransport
        ).finishAuth(code)
      }
      try {
        await client.close()
      } catch {
        // ignore
      }
      const transport2 = createTransport(server, { authProvider })
      const client2 = new Client({ name: 'vyotiq', version: '1.0.0' }, { capabilities: {} })
      await client2.connect(transport2)
      return { client: client2, transport: transport2 }
    } catch (oauthErr) {
      cancelMcpOAuthCallback(server.id)
      try {
        await client.close()
      } catch {
        // ignore
      }
      throw oauthErr
    }
  }
}

export async function connectMcpServer(server: McpServer): Promise<void> {
  if (sessions.has(server.id)) return
  // OAuth browser flow may take minutes; non-OAuth still fails fast via server errors.
  const CONNECT_TIMEOUT_MS = 120_000
  const connectAbort = AbortSignal.timeout(CONNECT_TIMEOUT_MS)
  let connected: { client: Client; transport: Transport }
  try {
    connected = await Promise.race([
      connectWithOptionalOAuth(server),
      new Promise<never>((_, reject) => {
        connectAbort.addEventListener(
          'abort',
          () =>
            reject(
              new Error(
                `MCP connect timed out after ${CONNECT_TIMEOUT_MS / 1000}s (${server.id})`
              )
            ),
          { once: true }
        )
      })
    ])
  } catch (err) {
    cancelMcpOAuthCallback(server.id)
    throw err
  }

  const { client, transport } = connected
  const listed = await client.listTools()
  const tools: ToolDefinition[] = (listed.tools ?? []).map((t) => {
    const fullName = mcpToolName(server.id, t.name)
    mcpReadOnlyHints.set(fullName, t.annotations?.readOnlyHint === true)
    return {
      name: fullName,
      description: t.description ?? `MCP tool ${t.name} (${server.name})`,
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} }
    }
  })
  sessions.set(server.id, { client, transport, tools })
  sessionConfigKeys.set(server.id, mcpServerConfigKey(server))
  connectErrors.delete(server.id)
  logger.info('MCP server connected', {
    scope: 'mcp',
    serverId: server.id,
    transport: server.transport ?? 'stdio',
    toolCount: tools.length
  })
}

/** Force re-auth for a remote MCP server (clears OAuth tokens and reconnects). */
export async function startMcpOAuth(serverId: string): Promise<void> {
  const id = serverId.trim()
  if (!id) throw new Error('MCP server id is required')
  clearMcpOAuthState(id)
  await disconnectMcpServer(id)
  const servers = resolveEffectiveMcpServers()
  const server = servers.find((s) => s.id === id)
  if (!server) throw new Error(`MCP server not found: ${id}`)
  if ((server.transport ?? 'stdio') === 'stdio') {
    throw new Error('OAuth is only supported for HTTP/SSE MCP servers')
  }
  if (!server.enabled) throw new Error('Enable the MCP server before starting OAuth')
  await connectMcpServer(server)
}

export async function disconnectMcpServer(serverId: string): Promise<void> {
  const session = sessions.get(serverId)
  if (!session) return
  try {
    await session.client.close()
  } catch {
    // ignore
  }
  for (const tool of session.tools) {
    mcpReadOnlyHints.delete(tool.name)
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

  // Migrate any leftover plaintext Bearer tokens into OS secure storage.
  let migratedAny = false
  const migratedServers = servers.map((server) => {
    const { server: next, migrated } = migratePlaintextMcpBearer(server)
    if (migrated) migratedAny = true
    return next
  })
  if (migratedAny) {
    try {
      const settings = getSettings()
      const byId = new Map(migratedServers.map((s) => [s.id, s]))
      const nextList = (settings.mcpServers ?? []).map((s) => byId.get(s.id) ?? s)
      // Also strip Authorization from any server we migrated that is in settings.
      for (const s of migratedServers) {
        if (!byId.has(s.id)) continue
        const idx = nextList.findIndex((x) => x.id === s.id)
        if (idx >= 0) nextList[idx] = s
      }
      setSettings({ mcpServers: nextList })
    } catch (err) {
      logger.warn('Failed to persist migrated MCP auth headers', { scope: 'mcp', err })
    }
  }

  const enabled = migratedServers.filter((s) => s.enabled)
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

export function getMcpToolDefinition(fullName: string): ToolDefinition | undefined {
  for (const session of sessions.values()) {
    const found = session.tools.find((t) => t.name === fullName)
    if (found) return found
  }
  return undefined
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
  mcpReadOnlyHints.clear()
}

/** Test helper — register MCP readOnlyHint values without a live server. */
export function setMcpReadOnlyHintsForTests(hints: Record<string, boolean>): void {
  for (const [name, readOnly] of Object.entries(hints)) {
    mcpReadOnlyHints.set(name, readOnly)
  }
}

/** Test helper — connected MCP server ids. */
export function listConnectedMcpServerIdsForTests(): string[] {
  return [...sessions.keys()]
}
