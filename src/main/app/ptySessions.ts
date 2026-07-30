import { randomUUID } from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc/channels'
import { workspacePathsEqual } from '../../shared/workspacePath'
import { getSettings } from '../settings/settings'
import { resolveTerminalShell } from '../agent/tools/terminal'
import type { PtySessionInfo } from '../../shared/ipc'

type SessionBackend =
  | { kind: 'pty'; /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ pty: any }
  | { kind: 'pipe'; child: ChildProcessWithoutNullStreams }

type PtyHandle = {
  id: string
  title: string
  cwd: string
  running: boolean
  backend: SessionBackend
}

const sessions = new Map<string, PtyHandle>()

function shellTitle(): string {
  const resolved = resolveTerminalShell(getSettings().terminalShell ?? 'auto')
  if (resolved === 'powershell') return 'powershell'
  if (resolved === 'cmd') return 'cmd'
  return 'bash'
}

function shellBinAndArgs(): { file: string; args: string[] } {
  const preference = getSettings().terminalShell ?? 'auto'
  const resolved = resolveTerminalShell(preference)
  if (resolved === 'powershell') {
    const pwsh = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
    return { file: pwsh, args: ['-NoLogo'] }
  }
  if (resolved === 'cmd') {
    return { file: 'cmd.exe', args: [] }
  }
  if (resolved === 'bash') {
    return { file: 'bash', args: ['-l'] }
  }
  const shell = process.env.SHELL || '/bin/bash'
  return { file: shell, args: ['-l'] }
}

function tryLoadPty(): typeof import('node-pty') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node-pty') as typeof import('node-pty')
  } catch {
    return null
  }
}

export function listPtySessions(workspacePath?: string): PtySessionInfo[] {
  const all = [...sessions.values()].map((s) => ({
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    running: s.running,
    backend: s.backend.kind
  }))
  if (!workspacePath) return all
  return all.filter((s) => workspacePathsEqual(s.cwd, workspacePath))
}

export function createPtySession(opts: {
  cwd: string
  cols?: number
  rows?: number
  sendTo: BrowserWindow
}): PtySessionInfo {
  const id = randomUUID()
  const title = shellTitle()
  const { file, args } = shellBinAndArgs()
  const nodePty = tryLoadPty()

  let backend: SessionBackend | null = null
  let usedPipeFallback = false

  if (nodePty) {
    try {
      const pty = nodePty.spawn(file, args, {
        name: 'xterm-color',
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        cwd: opts.cwd,
        env: process.env as Record<string, string>
      })
      backend = { kind: 'pty', pty }
      pty.onData((data: string) => {
        if (opts.sendTo.isDestroyed()) return
        opts.sendTo.webContents.send(IPC.ptyData, { id, data })
      })
      pty.onExit(({ exitCode }: { exitCode: number }) => {
        const handle = sessions.get(id)
        if (handle) handle.running = false
        if (!opts.sendTo.isDestroyed()) {
          opts.sendTo.webContents.send(IPC.ptyExit, { id, exitCode })
        }
      })
    } catch {
      backend = null
      usedPipeFallback = true
    }
  } else {
    usedPipeFallback = true
  }

  if (!backend) {
    // Fallback when native node-pty cannot load or spawn (missing rebuild / Spectre libs).
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    backend = { kind: 'pipe', child }
    const push = (buf: Buffer): void => {
      if (opts.sendTo.isDestroyed()) return
      opts.sendTo.webContents.send(IPC.ptyData, { id, data: buf.toString('utf8') })
    }
    child.stdout.on('data', push)
    child.stderr.on('data', push)
    child.on('exit', (code) => {
      const handle = sessions.get(id)
      if (handle) handle.running = false
      if (!opts.sendTo.isDestroyed()) {
        opts.sendTo.webContents.send(IPC.ptyExit, {
          id,
          exitCode: typeof code === 'number' ? code : null
        })
      }
    })
    if (usedPipeFallback && !opts.sendTo.isDestroyed()) {
      opts.sendTo.webContents.send(IPC.ptyData, {
        id,
        data: `[vyotiq] Interactive PTY unavailable (node-pty not built). Using pipe shell fallback.\r\n`
      })
    }
  }

  sessions.set(id, { id, title, cwd: opts.cwd, running: true, backend })
  return { id, title, cwd: opts.cwd, running: true, backend: backend.kind }
}

export function writePty(id: string, data: string): boolean {
  const s = sessions.get(id)
  if (!s?.running) return false
  if (s.backend.kind === 'pty') {
    s.backend.pty.write(data)
    return true
  }
  try {
    s.backend.child.stdin.write(data)
    return true
  } catch {
    return false
  }
}

export function resizePty(id: string, cols: number, rows: number): boolean {
  const s = sessions.get(id)
  if (!s || s.backend.kind !== 'pty') return false
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 2 || rows < 2) return false
  try {
    s.backend.pty.resize(cols, rows)
    return true
  } catch {
    return false
  }
}

export function killPty(id: string): boolean {
  const s = sessions.get(id)
  if (!s) return false
  try {
    if (s.backend.kind === 'pty') s.backend.pty.kill()
    else s.backend.child.kill()
  } catch {
    /* ignore */
  }
  sessions.delete(id)
  return true
}

export function disposePtySessionsForWorkspace(workspacePath: string): number {
  let n = 0
  for (const s of [...sessions.values()]) {
    if (!workspacePathsEqual(s.cwd, workspacePath)) continue
    if (killPty(s.id)) n += 1
  }
  return n
}

export function disposeAllPtySessions(): void {
  for (const id of [...sessions.keys()]) {
    killPty(id)
  }
}
