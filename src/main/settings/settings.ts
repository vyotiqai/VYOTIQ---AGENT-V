import { app } from 'electron'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '../../shared/ipc'
import { defaultModelFor, normalizeOllamaHost } from '../../shared/providers'
import { logger } from '../../shared/logger'
import { atomicWriteJson } from '../storage/atomicWrite'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function writeSettings(next: Settings): void {
  atomicWriteJson(settingsPath(), next)
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
  const p = settingsPath()
  if (!existsSync(p)) return { ...DEFAULT_SETTINGS }
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
      return normalizeSettings(merged)
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
