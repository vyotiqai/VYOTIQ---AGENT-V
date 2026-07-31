import { app, safeStorage } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  SECRET_PROVIDERS,
  emptySecretStatus,
  type SecretProvider,
  type SecretsStatus
} from '../../shared/ipc'
import { logger } from '../../shared/logger'

type SecretsFile = Record<string, string>

const MCP_AUTH_PREFIX = 'mcp-auth:'
const MCP_OAUTH_PREFIX = 'mcp-oauth:'
/** Single-app GitHub user access token (device OAuth). */
const GITHUB_TOKEN_KEY = 'github:access_token'

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function mcpAuthKey(serverId: string): string {
  return `${MCP_AUTH_PREFIX}${serverId}`
}

function mcpOauthKey(serverId: string): string {
  return `${MCP_OAUTH_PREFIX}${serverId}`
}

function readFile(): SecretsFile {
  const p = secretsPath()
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SecretsFile
  } catch (err) {
    logger.warn('Failed to read secrets file', { scope: 'secrets', code: 'SECRETS', err })
    return {}
  }
}

function writeFile(data: SecretsFile): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = secretsPath()
  try {
    writeFileSync(p, JSON.stringify(data, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
  } catch (err) {
    logger.error('Failed to write secrets file', { scope: 'secrets', code: 'SECRETS', err })
    throw err
  }
  if (process.platform !== 'win32') {
    try {
      chmodSync(p, 0o600)
    } catch {
      // best-effort restrictive mode
    }
  }
}

function encryptBlob(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function decryptBlob(encrypted: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch (err) {
    logger.warn('Failed to decrypt secret', { scope: 'secrets', code: 'SECRETS', err })
    return null
  }
}

export function setSecret(provider: SecretProvider, key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    throw new Error('API key cannot be empty')
  }
  let encrypted: string
  try {
    encrypted = encryptBlob(trimmed)
  } catch (err) {
    logger.error('Failed to encrypt secret', {
      scope: 'secrets',
      code: 'SECRETS',
      provider,
      err
    })
    throw err
  }
  const data = readFile()
  data[provider] = encrypted
  writeFile(data)
  logger.info('Secret saved', { scope: 'secrets', provider })
}

export function clearSecret(provider: SecretProvider): void {
  const data = readFile()
  if (!(provider in data)) return
  delete data[provider]
  writeFile(data)
  logger.info('Secret cleared', { scope: 'secrets', provider })
}

/** True when an encrypted blob exists for the provider (may still fail to decrypt). */
export function hasStoredSecretBlob(provider: SecretProvider): boolean {
  const encrypted = readFile()[provider]
  return typeof encrypted === 'string' && encrypted.length > 0
}

export function getSecret(provider: SecretProvider): string | null {
  const data = readFile()
  const encrypted = data[provider]
  if (!encrypted) return null
  return decryptBlob(encrypted)
}

/** True only when a stored blob decrypts successfully with the current OS keychain. */
export function secretStatus(): SecretsStatus {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const data = readFile()
  const keys = emptySecretStatus()
  for (const provider of SECRET_PROVIDERS) {
    const encrypted = data[provider]
    if (!encrypted || !encryptionAvailable) {
      keys[provider] = false
      continue
    }
    try {
      safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      keys[provider] = true
    } catch {
      keys[provider] = false
    }
  }
  return { encryptionAvailable, keys }
}

/** Store a Bearer token for an MCP server id (OS encrypted). */
export function setMcpAuthToken(serverId: string, token: string): void {
  const id = serverId.trim()
  if (!id) throw new Error('MCP server id is required')
  const trimmed = token.trim()
  if (!trimmed) throw new Error('MCP auth token cannot be empty')
  const data = readFile()
  data[mcpAuthKey(id)] = encryptBlob(trimmed)
  writeFile(data)
  logger.info('MCP auth token saved', { scope: 'secrets', serverId: id })
}

export function clearMcpAuthToken(serverId: string): void {
  const id = serverId.trim()
  if (!id) return
  const data = readFile()
  const key = mcpAuthKey(id)
  if (!(key in data)) return
  delete data[key]
  writeFile(data)
  logger.info('MCP auth token cleared', { scope: 'secrets', serverId: id })
}

export function getMcpAuthToken(serverId: string): string | null {
  const id = serverId.trim()
  if (!id) return null
  const encrypted = readFile()[mcpAuthKey(id)]
  if (!encrypted) return null
  return decryptBlob(encrypted)
}

/** True when an encrypted MCP bearer blob exists (does not decrypt). */
export function hasMcpAuthToken(serverId: string): boolean {
  const id = serverId.trim()
  if (!id) return false
  const encrypted = readFile()[mcpAuthKey(id)]
  return typeof encrypted === 'string' && encrypted.length > 0
}

/** True when an encrypted MCP OAuth blob exists (does not decrypt). */
export function hasStoredMcpOAuthBlob(serverId: string): boolean {
  const id = serverId.trim()
  if (!id) return false
  const encrypted = readFile()[mcpOauthKey(id)]
  return typeof encrypted === 'string' && encrypted.length > 0
}

/** Rename stored MCP auth when a server id changes. */
export function moveMcpAuthToken(fromId: string, toId: string): void {
  const from = fromId.trim()
  const to = toId.trim()
  if (!from || !to || from === to) return
  const token = getMcpAuthToken(from)
  if (!token) return
  setMcpAuthToken(to, token)
  clearMcpAuthToken(from)
  const oauth = getMcpOAuthState(from)
  if (oauth) {
    setMcpOAuthState(to, oauth)
    clearMcpOAuthState(from)
  }
}

/** Persisted OAuth session for a remote MCP server (tokens + PKCE + client info). */
export type McpOAuthStoredState = {
  tokens?: {
    access_token: string
    token_type?: string
    expires_in?: number
    scope?: string
    refresh_token?: string
  }
  codeVerifier?: string
  clientInformation?: Record<string, unknown>
  discoveryState?: Record<string, unknown>
}

export function setMcpOAuthState(serverId: string, state: McpOAuthStoredState): void {
  const id = serverId.trim()
  if (!id) throw new Error('MCP server id is required')
  const data = readFile()
  data[mcpOauthKey(id)] = encryptBlob(JSON.stringify(state))
  writeFile(data)
  logger.info('MCP OAuth state saved', { scope: 'secrets', serverId: id })
}

export function getMcpOAuthState(serverId: string): McpOAuthStoredState | null {
  const id = serverId.trim()
  if (!id) return null
  const encrypted = readFile()[mcpOauthKey(id)]
  if (!encrypted) return null
  const raw = decryptBlob(encrypted)
  if (!raw) return null
  try {
    return JSON.parse(raw) as McpOAuthStoredState
  } catch {
    return null
  }
}

export function hasMcpOAuthState(serverId: string): boolean {
  const state = getMcpOAuthState(serverId)
  return Boolean(state?.tokens?.access_token)
}

export function clearMcpOAuthState(serverId: string): void {
  const id = serverId.trim()
  if (!id) return
  const data = readFile()
  const key = mcpOauthKey(id)
  if (!(key in data)) return
  delete data[key]
  writeFile(data)
  logger.info('MCP OAuth state cleared', { scope: 'secrets', serverId: id })
}

export function patchMcpOAuthState(
  serverId: string,
  patch: Partial<McpOAuthStoredState>
): McpOAuthStoredState {
  const prev = getMcpOAuthState(serverId) ?? {}
  const next: McpOAuthStoredState = { ...prev, ...patch }
  setMcpOAuthState(serverId, next)
  return next
}

/** Persist GitHub device-OAuth access token (OS encrypted). */
export function setGithubAccessToken(token: string): void {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('GitHub token cannot be empty')
  const data = readFile()
  data[GITHUB_TOKEN_KEY] = encryptBlob(trimmed)
  writeFile(data)
  logger.info('GitHub access token saved', { scope: 'secrets' })
}

export function getGithubAccessToken(): string | null {
  const encrypted = readFile()[GITHUB_TOKEN_KEY]
  if (!encrypted) return null
  return decryptBlob(encrypted)
}

export function hasGithubAccessToken(): boolean {
  const encrypted = readFile()[GITHUB_TOKEN_KEY]
  return typeof encrypted === 'string' && encrypted.length > 0
}

export function clearGithubAccessToken(): void {
  const data = readFile()
  if (!(GITHUB_TOKEN_KEY in data)) return
  delete data[GITHUB_TOKEN_KEY]
  writeFile(data)
  logger.info('GitHub access token cleared', { scope: 'secrets' })
}
