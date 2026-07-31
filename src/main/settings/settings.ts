import { app } from 'electron'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '../../shared/ipc'
import { defaultModelFor, normalizeOllamaHost } from '../../shared/providers'
import { logger } from '../../shared/logger'
import { atomicWriteJson } from '../storage/atomicWrite'
import { sanitizeMcpManifestEnv } from '../marketplace/sanitizeMcpEnv'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function writeSettings(next: Settings): void {
  atomicWriteJson(settingsPath(), next)
  settingsCache = next
}

let settingsCache: Settings | null = null
/** Serializes async callers that must await between settings mutations (IPC handlers). */
let settingsMutationChain: Promise<unknown> = Promise.resolve()

/**
 * Queue a settings mutation so async IPC handlers cannot interleave
 * get→await→set RMW outside of setSettings itself.
 */
export function enqueueSettingsMutation<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = settingsMutationChain.then(() => fn())
  settingsMutationChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function sanitizeMcpServersInSettings(settings: Settings): Settings {
  if (!settings.mcpServers?.length) return settings
  return {
    ...settings,
    mcpServers: settings.mcpServers.map((s) => ({
      ...s,
      env: sanitizeMcpManifestEnv(s.env)
    }))
  }
}

export const REDACTED_HEADER_VALUE = '[redacted]'

/** Strip Authorization header values before sending settings over IPC. */
export function redactSettingsForIpc(settings: Settings): Settings {
  if (!settings.mcpServers?.length) return settings
  let changed = false
  const mcpServers = settings.mcpServers.map((s) => {
    if (!s.headers) return s
    const headers: Record<string, string> = {}
    let headerChanged = false
    for (const [key, value] of Object.entries(s.headers)) {
      if (/^authorization$/i.test(key) && value.trim()) {
        headers[key] = REDACTED_HEADER_VALUE
        headerChanged = true
      } else {
        headers[key] = value
      }
    }
    if (!headerChanged) return s
    changed = true
    return { ...s, headers }
  })
  return changed ? { ...settings, mcpServers } : settings
}

/**
 * Restore Authorization values that the renderer echoed back as `[redacted]`
 * after `redactSettingsForIpc`, so toggling MCP settings cannot wipe secrets.
 */
export function restoreRedactedMcpHeaders(
  prevServers: NonNullable<Settings['mcpServers']>,
  nextServers: NonNullable<Settings['mcpServers']>
): NonNullable<Settings['mcpServers']> {
  const prevById = new Map(prevServers.map((s) => [s.id, s]))
  return nextServers.map((server) => {
    if (!server.headers) return server
    const prior = prevById.get(server.id)
    if (!prior?.headers) return server
    let changed = false
    const headers: Record<string, string> = { ...server.headers }
    for (const [key, value] of Object.entries(headers)) {
      if (!/^authorization$/i.test(key)) continue
      if (value !== REDACTED_HEADER_VALUE) continue
      const priorValue = Object.entries(prior.headers).find(([k]) => /^authorization$/i.test(k))?.[1]
      if (priorValue && priorValue !== REDACTED_HEADER_VALUE) {
        headers[key] = priorValue
        changed = true
      }
    }
    return changed ? { ...server, headers } : server
  })
}

/** Drop in-memory settings cache (tests / external file edits). */
export function clearSettingsCacheForTests(): void {
  settingsCache = null
}

function normalizeSettings(data: Settings): Settings {
  const host = normalizeOllamaHost(data.ollamaBaseUrl)
  return host === data.ollamaBaseUrl ? data : { ...data, ollamaBaseUrl: host }
}

function stripLegacyFields(raw: Record<string, unknown>): Record<string, unknown> {
  const {
    workspacePath: _legacy,
    maxSteps: _maxSteps,
    maxAgentSteps: _maxAgentSteps,
    maxSubagentSteps: _maxSubagentSteps,
    ...rest
  } = raw
  return rest
}

/** Read legacy workspacePath from settings.json for one-time migration to workspaces.json. */
export function readLegacyWorkspacePath(): string | null {
  const p = settingsPath()
  if (!existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    const value = raw.workspacePath
    return typeof value === 'string' && value.trim() ? value : null
  } catch {
    return null
  }
}

export function getSettings(): Settings {
  if (settingsCache) return settingsCache
  const p = settingsPath()
  if (!existsSync(p)) {
    settingsCache = { ...DEFAULT_SETTINGS }
    return settingsCache
  }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    const parsed = SettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      ...stripLegacyFields(raw)
    })
    if (!parsed.success) {
      logger.warn('Settings schema mismatch; merging known fields', {
        scope: 'settings',
        code: 'SETTINGS'
      })
      const merged: Settings = { ...DEFAULT_SETTINGS }
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        const value = raw[key]
        const field = SettingsSchema.shape[key].safeParse(value)
        if (field.success) {
          ;(merged as Record<string, unknown>)[key] = field.data
        }
      }
      settingsCache = normalizeSettings(merged)
      return settingsCache
    }
    const data = normalizeSettings(parsed.data)
    if (data.ollamaBaseUrl !== parsed.data.ollamaBaseUrl) {
      try {
        writeSettings(data)
      } catch (err) {
        logger.warn('Failed to persist normalized Ollama URL', {
          scope: 'settings',
          code: 'SETTINGS',
          err
        })
      }
    }
    if (
      'workspacePath' in raw ||
      'maxSteps' in raw ||
      'maxAgentSteps' in raw ||
      'maxSubagentSteps' in raw
    ) {
      try {
        writeSettings(data)
      } catch (err) {
        logger.warn('Failed to strip legacy fields from settings', {
          scope: 'settings',
          code: 'SETTINGS',
          err
        })
      }
    }
    settingsCache = data
    return settingsCache
  } catch (err) {
    logger.warn('Failed to read settings', { scope: 'settings', code: 'SETTINGS', err })
    settingsCache = { ...DEFAULT_SETTINGS }
    return settingsCache
  }
}

function mcpServerIdentity(s: {
  id: string
  transport?: string
  command?: string
  url?: string
  args?: string[]
}): string {
  const transport = (s.transport ?? 'stdio').toLowerCase()
  if (transport === 'http' || transport === 'sse') {
    return `${transport}|${(s.url ?? '').trim()}`
  }
  return `stdio|${(s.command ?? '').trim()}|${(s.args ?? []).join('\0')}`
}

function mcpServerNeedsAck(s: {
  transport?: string
  command?: string
  url?: string
}): boolean {
  const transport = (s.transport ?? 'stdio').toLowerCase()
  if (transport === 'http' || transport === 'sse') return Boolean((s.url ?? '').trim())
  return Boolean((s.command ?? '').trim())
}

/** Require remoteInstallAcked when adding or changing stdio/remote MCP entries. */
function assertMcpServersAcked(
  prev: Settings,
  partial: Partial<Settings>,
  nextServers: NonNullable<Settings['mcpServers']>
): void {
  const acked =
    partial.marketplace?.remoteInstallAcked ?? prev.marketplace?.remoteInstallAcked
  if (acked) return
  const prevById = new Map((prev.mcpServers ?? []).map((s) => [s.id, s]))
  for (const server of nextServers) {
    if (!mcpServerNeedsAck(server)) continue
    const prior = prevById.get(server.id)
    if (!prior) {
      throw new Error(
        'Acknowledge marketplace / MCP installs in Settings → Registry before adding MCP servers.'
      )
    }
    if (mcpServerIdentity(prior) !== mcpServerIdentity(server)) {
      throw new Error(
        'Acknowledge marketplace / MCP installs in Settings → Registry before changing MCP server endpoints.'
      )
    }
  }
}

/**
 * Merge a partial into the latest settings and persist.
 * Always re-reads the in-memory cache so concurrent IPC partials compose
 * (last writer still wins for the same key, but distinct keys are not dropped
 * when callers use setSettings(partial) rather than get→mutate→write).
 *
 * Sync RMW is atomic on the main-process event loop; use `enqueueSettingsMutation`
 * when an async caller must await between read and write of derived state.
 */
export function setSettings(partial: Partial<Settings>): Settings {
  const prev = getSettings()
  let mcpServers = partial.mcpServers
  if (mcpServers !== undefined) {
    mcpServers = restoreRedactedMcpHeaders(prev.mcpServers ?? [], mcpServers)
    assertMcpServersAcked(prev, partial, mcpServers)
  }
  const merged = { ...prev, ...partial, ...(mcpServers !== undefined ? { mcpServers } : {}) }
  if (typeof merged.ollamaBaseUrl === 'string') {
    merged.ollamaBaseUrl = normalizeOllamaHost(merged.ollamaBaseUrl)
  }
  if (partial.provider !== undefined && partial.model === undefined) {
    merged.model = defaultModelFor(partial.provider)
  }
  const next = sanitizeMcpServersInSettings(SettingsSchema.parse(merged))
  try {
    writeSettings(next)
  } catch (err) {
    logger.error('Failed to write settings', { scope: 'settings', code: 'SETTINGS', err })
    throw err
  }
  if (partial.mcpServers !== undefined) {
    try {
      // Lazy require avoids circular import with marketplace/resolve → settings.
      const { invalidateMcpResolveCache } = require('../marketplace/resolve') as {
        invalidateMcpResolveCache: () => void
      }
      invalidateMcpResolveCache()
    } catch {
      // ignore if resolve module unavailable in early boot
    }
  }
  return next
}
