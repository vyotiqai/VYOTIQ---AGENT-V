import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { app } from 'electron'
import log from 'electron-log/main'
import { logger, setLoggerBackend, type LogFields, type LogLevel } from '../../shared/logger'
import { initSentryMain, captureExceptionMain } from './sentry'
import { isIgnorablePipeError } from './pipeErrors'

export { isIgnorablePipeError } from './pipeErrors'

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
  // Console writes to a closed pipe raise EPIPE; packaged / non-TTY runs skip console.
  const consoleWritable =
    isDev && Boolean(process.stdout?.writable) && process.stdout.isTTY !== false
  log.transports.console.level = consoleWritable ? 'debug' : false

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
  // crashReporter is started earlier in main/index.ts (before ready).
  initSentryMain()

  installProcessHandlers()
  logger.info('Logging initialized', { scope: 'main', logsDir })
}

function swallowStreamPipeError(err: Error): void {
  if (isIgnorablePipeError(err)) return
}

function installProcessHandlers(): void {
  process.stdout?.on?.('error', swallowStreamPipeError)
  process.stderr?.on?.('error', swallowStreamPipeError)

  function exitAfterFlush(): void {
    // Give the log transport a tick to flush the fatal message, then terminate.
    setTimeout(() => {
      process.exit(1)
    }, 250)
  }

  process.on('uncaughtException', (err) => {
    // Logging an EPIPE via console transport re-triggers write → infinite storm.
    if (isIgnorablePipeError(err)) return
    logger.fatal('Uncaught exception', {
      scope: 'main',
      code: 'UNCAUGHT',
      err
    })
    exitAfterFlush()
  })

  process.on('unhandledRejection', (reason) => {
    if (isIgnorablePipeError(reason)) return
    logger.fatal('Unhandled rejection', {
      scope: 'main',
      code: 'UNCAUGHT',
      err: reason instanceof Error ? reason : new Error(String(reason))
    })
    exitAfterFlush()
  })
}

export function logWithFields(level: LogLevel, message: string, fields?: LogFields): void {
  logger[level](message, fields)
}

export function attachWebContentsCrashLogging(
  webContents: Electron.WebContents
): void {
  webContents.on('render-process-gone', (_event, details) => {
    // Dev rebuild / intentional teardown — not a crash.
    if (details.reason === 'killed' || details.reason === 'clean-exit') {
      logger.info('Renderer process gone', {
        scope: 'main',
        reason: details.reason,
        exitCode: details.exitCode
      })
      return
    }
    let crashDumpsPath: string | undefined
    try {
      crashDumpsPath = app.getPath('crashDumps')
    } catch {
      crashDumpsPath = undefined
    }
    logger.error('Renderer process gone', {
      scope: 'main',
      code: 'RENDERER_CRASH',
      reason: details.reason,
      exitCode: details.exitCode,
      ...(crashDumpsPath ? { crashDumpsPath } : {})
    })
  })
  webContents.on('unresponsive', () => {
    logger.warn('Renderer unresponsive', { scope: 'main' })
  })
  webContents.on('responsive', () => {
    logger.info('Renderer responsive again', { scope: 'main' })
  })
}
