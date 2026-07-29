import { BrowserWindow, session, type WebContents } from 'electron'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { IPC } from '../../shared/channels'
import { assertPublicUrl, isSyncBlockedUrl } from '@main/agent/tools/webFetch'
import { getMainWindow } from '@main/app/window'
import { isAbortError } from '../../shared/errors'

const PARTITION = 'persist:vyotiq-agent-browser'
const DEFAULT_NAV_TIMEOUT_MS = 30_000
const MAX_NAV_TIMEOUT_MS = 60_000
const DEFAULT_SNAPSHOT_CHARS = 40_000
const SNAPSHOT_JPEG_QUALITY = 55
const MAX_PREVIEW_BYTES = 350_000

export type AgentBrowserState = {
  open: boolean
  url: string
  title: string
  /** Optional JPEG data URL from the latest snapshot (UI preview only). */
  snapshotDataUrl?: string | null
}

let browserWin: BrowserWindow | null = null
let lastState: AgentBrowserState = { open: false, url: '', title: '', snapshotDataUrl: null }

function pushState(partial: Partial<AgentBrowserState>): void {
  lastState = { ...lastState, ...partial }
  const main = getMainWindow()
  if (!main || main.isDestroyed()) return
  main.webContents.send(IPC.browserState, lastState)
}

function emitCurrent(extra?: Partial<AgentBrowserState>): void {
  const win = browserWin
  if (!win || win.isDestroyed()) {
    pushState({ open: false, url: '', title: '', snapshotDataUrl: null, ...extra })
    return
  }
  pushState({
    open: true,
    url: win.webContents.getURL(),
    title: win.webContents.getTitle(),
    ...extra
  })
}

function attachAgentSecurity(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    void navigateUrl(url).catch(() => undefined)
    return { action: 'deny' }
  })
  wc.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })

  // Sync reject private/loopback/non-http(s) on in-window navigations and redirects.
  // Full DNS SSRF is re-checked after load in navigateUrl.
  const blockPrivateNav = (event: Electron.Event, url: string): void => {
    if (isSyncBlockedUrl(url)) event.preventDefault()
  }
  wc.on('will-navigate', blockPrivateNav)
  wc.on('will-redirect', blockPrivateNav)
}

function ensureWindow(): BrowserWindow {
  if (browserWin && !browserWin.isDestroyed()) return browserWin

  const ses = session.fromPartition(PARTITION)
  browserWin = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: 'Vyotiq Browser',
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // No preload — never bridge app IPC into arbitrary web pages.
      javascript: true
    }
  })

  attachAgentSecurity(browserWin.webContents)

  browserWin.on('closed', () => {
    browserWin = null
    pushState({ open: false, url: '', title: '', snapshotDataUrl: null })
  })

  browserWin.webContents.on('did-navigate', () => emitCurrent())
  browserWin.webContents.on('did-navigate-in-page', () => emitCurrent())
  browserWin.webContents.on('page-title-updated', () => emitCurrent())

  return browserWin
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Aborted')
    err.name = 'AbortError'
    throw err
  }
}

async function waitForLoad(win: BrowserWindow, signal: AbortSignal | undefined, timeoutMs: number): Promise<void> {
  throwIfAborted(signal)
  await new Promise<void>((resolve, reject) => {
    const wc = win.webContents
    let settled = false
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Navigation timed out after ${timeoutMs}ms`)))
    }, timeoutMs)

    const onAbort = (): void => {
      finish(() => {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }

    const onDone = (): void => {
      finish(() => resolve())
    }

    const onFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ): void => {
      if (!isMainFrame) return
      // -3 is ABORTED (often from a superseding navigation).
      if (errorCode === -3) return
      finish(() => reject(new Error(errorDescription || `Navigation failed (${errorCode})`)))
    }

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      wc.removeListener('did-finish-load', onDone)
      wc.removeListener('did-fail-load', onFail)
      fn()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    wc.once('did-finish-load', onDone)
    wc.on('did-fail-load', onFail)
  })
}

/** Navigate the agent browser to a public http(s) URL. */
export async function navigateUrl(
  rawUrl: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<string> {
  const url = await assertPublicUrl(rawUrl)
  throwIfAborted(opts.signal)

  const timeoutMs = Math.min(
    MAX_NAV_TIMEOUT_MS,
    Math.max(1_000, opts.timeoutMs ?? DEFAULT_NAV_TIMEOUT_MS)
  )

  const win = ensureWindow()
  if (!win.isVisible()) win.show()
  win.focus()

  try {
    const loadPromise = waitForLoad(win, opts.signal, timeoutMs)
    void win.loadURL(url.toString())
    await loadPromise
  } catch (err) {
    if (isAbortError(err)) throw err
    throw err
  }

  const finalUrl = win.webContents.getURL()
  try {
    await assertPublicUrl(finalUrl)
  } catch (err) {
    void win.loadURL('about:blank')
    emitCurrent({ snapshotDataUrl: null })
    throw err
  }

  emitCurrent({ snapshotDataUrl: null })
  const title = win.webContents.getTitle()
  return [`Navigated to ${finalUrl}`, `Title: ${title || '(none)'}`].join('\n')
}

/** Accessibility text (+ optional JPEG on disk / UI preview) for the current page. */
export async function snapshotPage(
  opts: {
    signal?: AbortSignal
    maxChars?: number
    runDir?: string
  } = {}
): Promise<string> {
  throwIfAborted(opts.signal)
  const win = browserWin
  if (!win || win.isDestroyed()) {
    throw new Error('No browser page open. Call browser_navigate first.')
  }

  const maxChars = Math.max(1_000, opts.maxChars ?? DEFAULT_SNAPSHOT_CHARS)
  const url = win.webContents.getURL()
  const title = win.webContents.getTitle()

  const pageText: string = await win.webContents.executeJavaScript(
    `(() => {
      const title = document.title || ''
      const body = (document.body && (document.body.innerText || document.body.textContent)) || ''
      return (title ? title + '\\n\\n' : '') + String(body).slice(0, 200000)
    })()`,
    true
  )

  throwIfAborted(opts.signal)

  let imageNote = ''
  try {
    const image = await win.webContents.capturePage()
    const jpeg = image.toJPEG(SNAPSHOT_JPEG_QUALITY)
    if (opts.runDir) {
      const dir = join(opts.runDir, 'browser')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'snapshot.jpg'), jpeg)
      imageNote = `\n\n[Screenshot saved under run browser/snapshot.jpg (${jpeg.length} bytes)]`
    }
    if (jpeg.length > 0 && jpeg.length <= MAX_PREVIEW_BYTES) {
      emitCurrent({
        snapshotDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`
      })
    } else {
      emitCurrent({ snapshotDataUrl: null })
    }
  } catch {
    emitCurrent({ snapshotDataUrl: null })
  }

  const body = String(pageText ?? '').slice(0, maxChars)
  return [`URL: ${url}`, `Title: ${title || '(none)'}`, '', body].join('\n') + imageNote
}

export function focusAgentBrowser(): boolean {
  const win = browserWin
  if (!win || win.isDestroyed()) return false
  if (!win.isVisible()) win.show()
  win.focus()
  return true
}

export function closeAgentBrowser(): void {
  if (browserWin && !browserWin.isDestroyed()) {
    browserWin.close()
  }
  browserWin = null
  pushState({ open: false, url: '', title: '', snapshotDataUrl: null })
}

export function getAgentBrowserState(): AgentBrowserState {
  return lastState
}

/** Test helper — reset singleton without touching Electron windows. */
export function resetAgentBrowserForTests(): void {
  browserWin = null
  lastState = { open: false, url: '', title: '', snapshotDataUrl: null }
}
