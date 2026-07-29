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
const MAX_PREVIEW_BYTES = 150_000
const PREVIEW_MAX_WIDTH = 960

export type AgentBrowserState = {
  open: boolean
  url: string
  title: string
  /** Optional JPEG data URL from the latest snapshot (UI preview only). */
  snapshotDataUrl?: string | null
}

let browserWin: BrowserWindow | null = null
let lastState: AgentBrowserState = { open: false, url: '', title: '', snapshotDataUrl: null }
/** Serialize navigate/click/type/snapshot across concurrent runs sharing one window. */
let browserOpChain: Promise<void> = Promise.resolve()

function withBrowserLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = browserOpChain.then(fn, fn)
  browserOpChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

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
  const blockPrivateNav = (event: Electron.Event, url: string): void => {
    if (isSyncBlockedUrl(url)) event.preventDefault()
  }
  wc.on('will-navigate', blockPrivateNav)
  wc.on('will-redirect', blockPrivateNav)

  // Full DNS SSRF after any load (navigate, click, form submit, meta refresh).
  wc.on('did-finish-load', () => {
    void enforcePublicPage(wc)
  })
}

/** Blank the page if the settled URL is private/loopback (async DNS). */
async function enforcePublicPage(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return
  const url = wc.getURL()
  if (!url || url === 'about:blank' || url.startsWith('chrome-error://')) return
  try {
    await assertPublicUrl(url)
  } catch {
    if (wc.isDestroyed()) return
    void wc.loadURL('about:blank')
    emitCurrent({ snapshotDataUrl: null })
  }
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
  return withBrowserLock(() => navigateUrlUnlocked(rawUrl, opts))
}

async function navigateUrlUnlocked(
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
  return withBrowserLock(() => snapshotPageUnlocked(opts))
}

async function snapshotPageUnlocked(
  opts: {
    signal?: AbortSignal
    maxChars?: number
    runDir?: string
  } = {}
): Promise<string> {
  throwIfAborted(opts.signal)
  const win = requireOpenWindow()

  const maxChars = Math.max(1_000, opts.maxChars ?? DEFAULT_SNAPSHOT_CHARS)
  const url = win.webContents.getURL()
  const title = win.webContents.getTitle()

  const pageText: string = await win.webContents.executeJavaScript(
    `(() => {
      const title = document.title || ''
      const body = (document.body && (document.body.innerText || document.body.textContent)) || ''
      return (title ? title + '\\n\\n' : '') + String(body).slice(0, ${maxChars})
    })()`,
    true
  )

  throwIfAborted(opts.signal)

  let imageNote = ''
  try {
    let image = await win.webContents.capturePage()
    const size = image.getSize()
    if (size.width > PREVIEW_MAX_WIDTH) {
      image = image.resize({ width: PREVIEW_MAX_WIDTH, quality: 'better' })
    }
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

function requireOpenWindow(): BrowserWindow {
  const win = browserWin
  if (!win || win.isDestroyed()) {
    throw new Error('No browser page open. Call browser_navigate first.')
  }
  return win
}

type ElementHit = {
  x: number
  y: number
  tag: string
  label: string
}

async function resolveSelector(win: BrowserWindow, selector: string): Promise<ElementHit> {
  const hit = (await win.webContents.executeJavaScript(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return null
      const label = (
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('name') ||
        (typeof el.value === 'string' ? el.value : '') ||
        el.innerText ||
        ''
      ).slice(0, 120)
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        tag: el.tagName,
        label: String(label).trim()
      }
    })()`,
    true
  )) as ElementHit | null

  if (!hit) {
    throw new Error(`No visible element matched selector: ${selector}`)
  }
  return hit
}

/** Click a CSS-selected element in the agent browser (via mouse input events). */
export async function clickSelector(
  selector: string,
  opts: { signal?: AbortSignal; button?: 'left' | 'right' | 'middle' } = {}
): Promise<string> {
  return withBrowserLock(() => clickSelectorUnlocked(selector, opts))
}

async function clickSelectorUnlocked(
  selector: string,
  opts: { signal?: AbortSignal; button?: 'left' | 'right' | 'middle' } = {}
): Promise<string> {
  throwIfAborted(opts.signal)
  const sel = String(selector ?? '').trim()
  if (!sel) throw new Error('selector is required')

  const win = requireOpenWindow()
  if (!win.isVisible()) win.show()
  win.focus()

  const hit = await resolveSelector(win, sel)
  throwIfAborted(opts.signal)

  const button = opts.button ?? 'left'
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    x: hit.x,
    y: hit.y,
    button,
    clickCount: 1
  })
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    x: hit.x,
    y: hit.y,
    button,
    clickCount: 1
  })

  emitCurrent()
  const label = hit.label ? ` "${hit.label}"` : ''
  return `Clicked ${hit.tag}${label} at (${hit.x}, ${hit.y}) via ${sel}`
}

const MAX_TYPE_CHARS = 4_000

/** Type into the focused element, optionally focusing a CSS selector first. */
export async function typeText(
  text: string,
  opts: {
    signal?: AbortSignal
    selector?: string
    clear?: boolean
    pressEnter?: boolean
  } = {}
): Promise<string> {
  return withBrowserLock(() => typeTextUnlocked(text, opts))
}

async function typeTextUnlocked(
  text: string,
  opts: {
    signal?: AbortSignal
    selector?: string
    clear?: boolean
    pressEnter?: boolean
  } = {}
): Promise<string> {
  throwIfAborted(opts.signal)
  const value = String(text ?? '')
  if (value.length > MAX_TYPE_CHARS) {
    throw new Error(`text exceeds ${MAX_TYPE_CHARS} characters`)
  }

  const win = requireOpenWindow()
  if (!win.isVisible()) win.show()
  win.focus()

  let focusNote = 'active element'
  const selector = opts.selector?.trim()
  if (selector) {
    const hit = await resolveSelector(win, selector)
    throwIfAborted(opts.signal)
    win.webContents.sendInputEvent({
      type: 'mouseDown',
      x: hit.x,
      y: hit.y,
      button: 'left',
      clickCount: 1
    })
    win.webContents.sendInputEvent({
      type: 'mouseUp',
      x: hit.x,
      y: hit.y,
      button: 'left',
      clickCount: 1
    })
    focusNote = `${hit.tag}${hit.label ? ` "${hit.label}"` : ''} (${selector})`
  } else {
    await win.webContents.executeJavaScript(
      `(() => {
        const el = document.activeElement
        if (el && typeof el.focus === 'function') el.focus()
        return true
      })()`,
      true
    )
  }

  throwIfAborted(opts.signal)

  if (opts.clear) {
    // Select-all then delete (works across platforms for most inputs).
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
  }

  // Bulk insert avoids thousands of per-character sendInputEvent calls.
  if (value.length > 0) {
    win.webContents.insertText(value)
  }

  if (opts.pressEnter) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
  }

  emitCurrent()
  const clearNote = opts.clear ? ', cleared first' : ''
  const enterNote = opts.pressEnter ? ', pressed Enter' : ''
  return `Typed ${value.length} character(s) into ${focusNote}${clearNote}${enterNote}`
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
  browserOpChain = Promise.resolve()
}
