import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '../shared/ipc'
import { defaultModelFor, normalizeOllamaHost } from '../shared/providers'
import { logger } from '../shared/logger'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function writeSettings(next: Settings): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
}

function normalizeSettings(data: Settings): Settings {
  const host = normalizeOllamaHost(data.ollamaBaseUrl)
  return host === data.ollamaBaseUrl ? data : { ...data, ollamaBaseUrl: host }
}

export function getSettings(): Settings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...DEFAULT_SETTINGS }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown
    const parsed = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(raw as object) })
    if (!parsed.success) {
      logger.warn('Settings schema mismatch; using defaults', {
        scope: 'settings',
        code: 'SETTINGS'
      })
      return { ...DEFAULT_SETTINGS }
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
    return data
  } catch (err) {
    logger.warn('Failed to read settings', { scope: 'settings', code: 'SETTINGS', err })
    return { ...DEFAULT_SETTINGS }
  }
}

export function setSettings(partial: Partial<Settings>): Settings {
  const merged = { ...getSettings(), ...partial }
  if (typeof merged.ollamaBaseUrl === 'string') {
    merged.ollamaBaseUrl = normalizeOllamaHost(merged.ollamaBaseUrl)
  }
  if (partial.provider !== undefined && partial.model === undefined) {
    merged.model = defaultModelFor(partial.provider)
  }
  const next = SettingsSchema.parse(merged)
  try {
    writeSettings(next)
  } catch (err) {
    logger.error('Failed to write settings', { scope: 'settings', code: 'SETTINGS', err })
    throw err
  }
  return next
}
