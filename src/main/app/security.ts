import { BrowserWindow, session } from 'electron'
import { shell } from 'electron'
import { is } from '@electron-toolkit/utils'

const ALLOWED_EXTERNAL = [/^https?:\/\//i]

export function attachSecurity(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ALLOWED_EXTERNAL.some((re) => re.test(url))) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url !== current) event.preventDefault()
  })

  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
}

/** Dev needs unsafe-inline/eval + ws for Vite React Refresh / HMR. Prod stays strict. */
function cspPolicy(): string {
  if (is.dev) {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob:",
      "connect-src 'self' ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:* http://127.0.0.1:* http://localhost:* https:"
    ].join('; ')
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:* http://localhost:* https:"
  ].join('; ')
}

export function applyCsp(): void {
  const policy = cspPolicy()
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}
