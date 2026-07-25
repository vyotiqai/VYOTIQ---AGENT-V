import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { app } from 'electron'
import log from 'electron-log/main'
import { logger, setLoggerBackend, type LogFields, type LogLevel } from '../../shared/logger'
import { initSentryMain, captureExceptionMain } from './sentry'

export function logsDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

function ensureLogsDirectory(): string {
  const dir = logsDirectory()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function mapLevel(level: LogLevel): 'debug' | 'info' | 'warn' | 'error' {
  if (level === 'fatal') return 'error'
  return level
}

/**
 * Configure rotating file logs under userData/logs and bridge renderer → main.
 * Call after any userData path changes and before registerIpc / windows.
 */
export function initMainLogging(): void {
  const logsDir = ensureLogsDirectory()
  const isDev = !app.isPackaged

  log.initialize()
  log.transports.file.resolvePathFn = (): string => join(logsDir, 'vyotiq.log')
  log.transports.file.maxSize = 5 * 1024 * 1024 // 5 MB then rotate
  log.transports.file.level = isDev ? 'debug' : 'info'
  log.transports.console.level = isDev ? 'debug' : 'warn'

  setLoggerBackend({
    log: (level, message, fields) => {
      const scope = fields?.scope ? `[${fields.scope}] ` : ''
      const cid = fields?.correlationId ? `{${fields.correlationId}} ` : ''
      // Shared logger already scrubbed fields (including Error → { name, message, stack, ... }).
      const { scope: _s, correlationId: _c, ...rest } = fields ?? {}
      const line = `${scope}${cid}${message}`
      const fn = log[mapLevel(level)].bind(log)
      if (Object.keys(rest).length) fn(line, rest)
      else fn(line)
    },
    captureException: (err, fields) => {
      captureExceptionMain(err, fields)
    }
  })

  // Optional Sentry (DSN + telemetryEnabled). Safe no-op when gated off.
  initSentryMain()

  installProcessHandlers()
  logger.info('Logging initialized', { scope: 'main', logsDir })
}

function installProcessHandlers(): void {
  process.on('uncaughtException', (err) => {
    logger.fatal('Uncaught exception', {
      scope: 'main',
      code: 'UNCAUGHT',
      err
    })
  })

  process.on('unhandledRejection', (reason) => {
    logger.fatal('Unhandled rejection', {
      scope: 'main',
      code: 'UNCAUGHT',
      err: reason instanceof Error ? reason : new Error(String(reason))
    })
  })
}

export function logWithFields(level: LogLevel, message: string, fields?: LogFields): void {
  logger[level](message, fields)
}

export function attachWebContentsCrashLogging(
  webContents: Electron.WebContents
): void {
  webContents.on('render-process-gone', (_event, details) => {
    logger.error('Renderer process gone', {
      scope: 'main',
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
  webContents.on('unresponsive', () => {
    logger.warn('Renderer unresponsive', { scope: 'main' })
  })
  webContents.on('responsive', () => {
    logger.info('Renderer responsive again', { scope: 'main' })
  })
}
