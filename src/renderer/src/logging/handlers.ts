import { logger } from '@shared/logger'
import { captureRendererException } from './sentry'

let installed = false

/** Global renderer error hooks — catches errors outside React's ErrorBoundary. */
export function installRendererErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    const err = event.error ?? new Error(event.message || 'Unknown error')
    logger.fatal('Uncaught renderer error', {
      scope: 'renderer',
      code: 'UNCAUGHT',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      err
    })
    captureRendererException(err, { scope: 'renderer', code: 'UNCAUGHT' })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const err = reason instanceof Error ? reason : new Error(String(reason))
    logger.fatal('Unhandled renderer rejection', {
      scope: 'renderer',
      code: 'UNCAUGHT',
      err
    })
    captureRendererException(err, { scope: 'renderer', code: 'UNCAUGHT' })
  })
}

export function isRendererErrorHandlersInstalled(): boolean {
  return installed
}
