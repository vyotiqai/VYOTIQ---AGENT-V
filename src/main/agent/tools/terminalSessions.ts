import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import kill from 'tree-kill'
import {
  commandOnPath,
  formatTerminalSessionOutput,
  resolveTerminalShell,
  sanitizedTerminalEnv,
  terminalSpawnSpec,
  unsupportedUnixOnWindowsMessage,
  type ResolvedTerminalShell,
  TERMINAL_MAX_OUTPUT
} from './terminal'
import type { TerminalShell } from '../../../shared/ipc'

export type TerminalSessionStatus = 'running' | 'done' | 'timeout' | 'pattern_matched' | 'aborted'

type TerminalSession = {
  id: string
  workspaceRoot: string
  command: string
  shell: ResolvedTerminalShell
  child: ChildProcess
  stdout: string
  stderr: string
  exitCode: number | null
  running: boolean
  status: TerminalSessionStatus
  pattern?: RegExp
  createdAt: number
}

const sessions = new Map<string, TerminalSession>()
const MAX_OUTPUT = TERMINAL_MAX_OUTPUT

function appendCapped(prev: string, chunk: string): string {
  if (prev.length >= MAX_OUTPUT) return prev
  const next = prev + chunk
  return next.length > MAX_OUTPUT ? next.slice(0, MAX_OUTPUT) : next
}

function matchesPattern(session: TerminalSession): boolean {
  if (!session.pattern) return false
  const hay = `${session.stdout}\n${session.stderr}`
  return session.pattern.test(hay)
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id)
}

export function disposeTerminalSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.running && session.child.pid) {
    try {
      kill(session.child.pid)
    } catch {
      // ignore
    }
  }
  sessions.delete(id)
}

export function resetTerminalSessionsForTests(): void {
  for (const id of [...sessions.keys()]) disposeTerminalSession(id)
}

function formatSession(session: TerminalSession): string {
  return formatTerminalSessionOutput({
    workspaceRoot: session.workspaceRoot,
    command: session.command,
    shell: session.shell,
    stdout: session.stdout,
    stderr: session.stderr,
    exitCode: session.exitCode,
    sessionId: session.id,
    status: session.status
  })
}

export type StartBackgroundTerminalOpts = {
  workspaceRoot: string
  command: string
  signal: AbortSignal
  shell?: TerminalShell
  pattern?: string
  /** Wait this long before returning (0 = immediate). */
  blockUntilMs: number
}

export async function startBackgroundTerminal(
  opts: StartBackgroundTerminalOpts
): Promise<string> {
  const command = opts.command.trim()
  if (!command) throw new Error('command is required to start a terminal session')

  const resolved = resolveTerminalShell(opts.shell ?? 'auto')
  if (resolved === 'cmd') {
    const unixHint = unsupportedUnixOnWindowsMessage(command)
    if (unixHint) {
      return `cwd: ${opts.workspaceRoot}\nshell: cmd\n\n${unixHint}`
    }
  }
  if (resolved === 'bash' && !commandOnPath('bash')) {
    return [
      `cwd: ${opts.workspaceRoot}`,
      'shell: bash',
      '',
      'bash was not found on PATH.',
      'exit_code: 1'
    ].join('\n')
  }
  if (resolved === 'powershell' && !commandOnPath('pwsh') && !commandOnPath('powershell')) {
    return [
      `cwd: ${opts.workspaceRoot}`,
      'shell: powershell',
      '',
      'PowerShell was not found on PATH.',
      'exit_code: 1'
    ].join('\n')
  }

  const spec = terminalSpawnSpec(command, resolved)
  const id = randomUUID()
  let pattern: RegExp | undefined
  if (opts.pattern?.trim()) {
    try {
      pattern = new RegExp(opts.pattern)
    } catch {
      throw new Error(`Invalid terminal pattern regex: ${opts.pattern}`)
    }
  }

  const child = spawn(spec.bin, spec.args, {
    cwd: opts.workspaceRoot,
    env: sanitizedTerminalEnv(),
    windowsHide: true
  })

  const session: TerminalSession = {
    id,
    workspaceRoot: opts.workspaceRoot,
    command,
    shell: resolved,
    child,
    stdout: '',
    stderr: '',
    exitCode: null,
    running: true,
    status: 'running',
    pattern,
    createdAt: Date.now()
  }
  sessions.set(id, session)

  const onAbort = (): void => {
    if (session.running && child.pid) kill(child.pid)
    session.running = false
    session.status = 'aborted'
  }
  if (opts.signal.aborted) onAbort()
  else opts.signal.addEventListener('abort', onAbort, { once: true })

  child.stdout?.on('data', (buf: Buffer) => {
    session.stdout = appendCapped(session.stdout, buf.toString('utf8'))
    if (matchesPattern(session) && session.running) {
      session.status = 'pattern_matched'
    }
  })
  child.stderr?.on('data', (buf: Buffer) => {
    session.stderr = appendCapped(session.stderr, buf.toString('utf8'))
    if (matchesPattern(session) && session.running) {
      session.status = 'pattern_matched'
    }
  })
  child.on('error', () => {
    session.running = false
    session.status = 'done'
    session.exitCode = 1
  })
  child.on('close', (code) => {
    session.running = false
    session.exitCode = code
    if (session.status === 'running' || session.status === 'pattern_matched') {
      session.status = matchesPattern(session) ? 'pattern_matched' : 'done'
    }
    opts.signal.removeEventListener('abort', onAbort)
  })

  return await pollTerminalSession({
    sessionId: id,
    blockUntilMs: opts.blockUntilMs,
    pattern: opts.pattern,
    signal: opts.signal
  })
}

export type PollTerminalSessionOpts = {
  sessionId: string
  blockUntilMs: number
  pattern?: string
  signal: AbortSignal
}

export async function pollTerminalSession(opts: PollTerminalSessionOpts): Promise<string> {
  const session = sessions.get(opts.sessionId)
  if (!session) {
    throw new Error(`Unknown terminal session_id: ${opts.sessionId}`)
  }
  if (opts.pattern?.trim()) {
    try {
      session.pattern = new RegExp(opts.pattern)
    } catch {
      throw new Error(`Invalid terminal pattern regex: ${opts.pattern}`)
    }
  }

  const deadline = Date.now() + Math.max(0, opts.blockUntilMs)
  while (Date.now() < deadline) {
    if (opts.signal.aborted) {
      session.status = 'aborted'
      break
    }
    if (!session.running) break
    if (matchesPattern(session)) {
      session.status = 'pattern_matched'
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  if (session.running && opts.blockUntilMs > 0 && session.status === 'running') {
    // Timed out waiting; leave process running for further polls.
    return formatSession({ ...session, status: 'timeout' })
  }
  return formatSession(session)
}
