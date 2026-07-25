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

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
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

export function setSecret(provider: SecretProvider, key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable')
  }
  const trimmed = key.trim()
  if (!trimmed) {
    throw new Error('API key cannot be empty')
  }
  let encrypted: string
  try {
    encrypted = safeStorage.encryptString(trimmed).toString('base64')
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

export function getSecret(provider: SecretProvider): string | null {
  const data = readFile()
  const encrypted = data[provider]
  if (!encrypted) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch (err) {
    logger.warn('Failed to decrypt secret', { scope: 'secrets', code: 'SECRETS', provider, err })
    return null
  }
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
