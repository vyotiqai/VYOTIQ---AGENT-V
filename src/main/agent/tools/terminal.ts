import { spawn } from 'child_process'
import kill from 'tree-kill'
import { assertInsideWorkspace } from '../../../shared/workspacePath'

/** stdout/stderr cap returned to the model (each stream). */
export const TERMINAL_MAX_OUTPUT = 64 * 1024
const MAX_OUTPUT = TERMINAL_MAX_OUTPUT

/** Unix tools that typically fail or mislead under Windows cmd.exe. */
const UNIX_PRIMARY_ON_WINDOWS = new Set([
  'ls',
  'grep',
  'egrep',
  'fgrep',
  'head',
  'tail',
  'find',
  'cat',
  'which',
  'pwd',
  'rm',
  'cp',
  'mv',
  'chmod',
  'chown',
  'touch',
  'ln',
  'wc',
  'awk',
  'sed',
  'xargs',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'stat',
  'uname',
  'tee',
  'tr',
  'cut',
  'uniq',
  'export',
  'source',
  'bash',
  'sh',
  'zsh'
])

const UNIX_CMD_HINTS: Record<string, string> = {
  ls: 'dir',
  grep: 'findstr',
  egrep: 'findstr',
  fgrep: 'findstr',
  head: 'more (or PowerShell Get-Content -TotalCount)',
  tail: 'PowerShell Get-Content -Tail',
  find: 'dir /s /b',
  cat: 'type',
  which: 'where',
  pwd: 'echo %CD%',
  rm: 'del',
  cp: 'copy',
  mv: 'move',
  touch: 'type nul > file',
  wc: 'find /c /v ""',
  bash: 'cmd.exe builtins',
  sh: 'cmd.exe builtins',
  zsh: 'cmd.exe builtins'
}

function unixShellInvocation(command: string): { bin: string; args: string[] } {
  const shell = process.env.SHELL?.trim()
  if (shell) return { bin: shell, args: ['-lc', command] }
  return { bin: '/bin/sh', args: ['-c', command] }
}

/** First executable token of a command (cmd-safe parsing). Exported for tests. */
export function primaryCommandToken(command: string): string | null {
  let s = command.trim()
  if (!s) return null
  s = s.replace(/^(?:cmd(?:\.exe)?\s+\/c\s+)/i, '')
  const first = s.split(/\s*(?:&&|\|\||[|;&])\s*/)[0]?.trim() ?? ''
  if (!first) return null
  const m = first.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/)
  const raw = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim()
  if (!raw) return null
  const base = raw.replace(/^.*[/\\]/, '').replace(/\.(?:exe|cmd|bat)$/i, '')
  return base.toLowerCase() || null
}

/** Last pipeline stage token (e.g. `dir | findstr x` → findstr). Exported for tests. */
export function lastPipelineCommandToken(command: string): string | null {
  const stages = command.split('|')
  const last = stages[stages.length - 1] ?? command
  return primaryCommandToken(last)
}

/**
 * On Windows, if any pipeline stage's primary command is a common Unix builtin,
 * return a helpful failure message (no spawn). Otherwise null.
 */
export function unsupportedUnixOnWindowsMessage(command: string): string | null {
  const stages = command
    .split('|')
    .map((s) => primaryCommandToken(s.trim()))
    .filter((t): t is string => Boolean(t))
  const unixStages = stages.filter((t) => UNIX_PRIMARY_ON_WINDOWS.has(t))
  if (!unixStages.length) return null
  const token = unixStages[0]
  const equiv = UNIX_CMD_HINTS[token] ?? 'a cmd.exe-compatible command'
  const stageNote =
    unixStages.length > 1
      ? ` Also blocked in pipeline: ${unixStages.slice(1).join(', ')}.`
      : ''
  return [
    `Unsupported Unix command on Windows: "${token}".`,
    'The terminal tool runs via cmd.exe, not bash or PowerShell.',
    `Prefer cmd-safe commands (dir, findstr, where, type, echo %CD%) — e.g. use "${equiv}" instead of "${token}".${stageNote}`,
    'Do not use ls/grep/head/find/cat/which unless bash is available.',
    'exit_code: 1'
  ].join('\n')
}

/** Append Windows cmd hints when a pipeline stage used a Unix-only tool. */
function appendWindowsCompatHint(command: string, content: string, exitCode: number | null): string {
  if (process.platform !== 'win32') return content
  if (exitCode === 0 || exitCode === null) return content
  const stages = command
    .split('|')
    .map((s) => primaryCommandToken(s.trim()))
    .filter((t): t is string => Boolean(t))
  const unixStages = stages.filter((t) => UNIX_PRIMARY_ON_WINDOWS.has(t))
  if (!unixStages.length) return content
  const hints = unixStages.map((t) => {
    const equiv = UNIX_CMD_HINTS[t] ?? 'cmd.exe-compatible commands'
    return `"${t}" → try ${equiv}`
  })
  return `${content}\n\n[Windows hint] cmd.exe does not support: ${hints.join('; ')}. Use dir, findstr, where, type, or PowerShell.`
}

/**
 * findstr exit 1 = no matches (soft success). Exit 2 = error.
 * Reject catastrophic stderr (command missing / path errors).
 */
export function isFindstrNoMatch(
  command: string,
  exitCode: number | null | undefined,
  stdout: string,
  stderr: string
): boolean {
  if (exitCode !== 1) return false
  if (lastPipelineCommandToken(command) !== 'findstr') return false
  if (/not recognized|cannot find the (?:path|file)|The system cannot find/i.test(stderr)) {
    return false
  }
  // No matches → empty/minimal stdout
  return stdout.trim().length === 0
}

import { parseTerminalOutput } from '../../../shared/utils/terminalFormat'

/** Parse terminal tool content for findstr no-match soft success. Exported for tests. */
export function isFindstrNoMatchContent(command: string, content: string): boolean {
  const { stdout, stderr, exitCode } = parseTerminalOutput(content)
  if (exitCode == null) return false
  let cleanedStdout = stdout.replace(/^findstr: no matches\n?/m, '')
  return isFindstrNoMatch(command, exitCode, cleanedStdout, stderr)
}

/**
 * Windows `dir` exit 1 when the target path does not exist — informative, not a tool fault.
 */
export function isDirMissingPath(
  command: string,
  exitCode: number | null | undefined,
  stdout: string,
  stderr: string
): boolean {
  if (process.platform !== 'win32') return false
  if (exitCode !== 1) return false
  if (primaryCommandToken(command) !== 'dir') return false
  const combined = `${stdout}\n${stderr}`
  if (/not recognized|cannot find the (?:path|file)|The system cannot find/i.test(combined)) {
    return true
  }
  if (/File Not Found/i.test(combined)) return true
  return false
}

/** Parse terminal tool content for dir missing-path soft success. Exported for tests. */
export function isDirMissingPathContent(command: string, content: string): boolean {
  const { stdout, stderr, exitCode } = parseTerminalOutput(content)
  if (exitCode == null) return false
  const cleanedStdout = stdout.replace(/^dir: path not found\n?/m, '')
  return isDirMissingPath(command, exitCode, cleanedStdout, stderr)
}

function formatTerminalOutput(
  workspaceRoot: string,
  command: string,
  stdout: string,
  stderr: string,
  code: number | null,
  annotations: string[]
): string {
  const isWin = process.platform === 'win32'
  const dirMissing = isWin && isDirMissingPath(command, code, stdout, stderr)
  let out = [
    `cwd: ${workspaceRoot}`,
    '',
    ...annotations,
    stdout.slice(0, MAX_OUTPUT),
    dirMissing ? 'dir: path not found' : '',
    stderr ? `stderr:\n${stderr.slice(0, MAX_OUTPUT)}` : '',
    `exit_code: ${code ?? -1}`
  ]
    .filter(Boolean)
    .join('\n')
  out = appendWindowsCompatHint(command, out, code)
  return out
}

/**
 * Minimal env for child shells — omit parent secrets (API keys, tokens) that
 * live on process.env in the Electron main process.
 */
export function sanitizedTerminalEnv(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const keys = [
    'PATH',
    'Path',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'USERNAME',
    'USER',
    'LOGNAME',
    'TMP',
    'TEMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'ComSpec',
    'COMSPEC',
    'SystemRoot',
    'SYSTEMROOT',
    'SystemDrive',
    'SYSTEMDRIVE',
    'windir',
    'WINDIR',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'OS',
    'SHELL',
    'PWD',
    'OLDPWD',
    'HOMEBREW_PREFIX',
    'HOMEBREW_CELLAR'
  ]

  const env: Record<string, string> = {}
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) env[key] = value
  }
  // Ensure PATH exists even if the parent somehow lacks it.
  if (!env.PATH && !env.Path) {
    env.PATH = source.PATH ?? source.Path ?? ''
  }
  return env
}

export async function toolTerminal(
  workspaceRoot: string,
  command: string,
  signal: AbortSignal,
  timeoutMs = 60_000
): Promise<string> {
  assertInsideWorkspace(workspaceRoot, '.')

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const isWin = process.platform === 'win32'

    if (isWin) {
      const unixHint = unsupportedUnixOnWindowsMessage(command)
      if (unixHint) {
        resolve(`cwd: ${workspaceRoot}\n\n${unixHint}`)
        return
      }
    }

    const unix = isWin ? null : unixShellInvocation(command)
    const child = spawn(
      isWin ? 'cmd.exe' : unix!.bin,
      isWin ? ['/c', command] : unix!.args,
      {
        cwd: workspaceRoot,
        env: sanitizedTerminalEnv(),
        windowsHide: true
      }
    )

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const onAbort = (): void => {
      if (child.pid) kill(child.pid)
      finish(() => reject(new DOMException('Aborted', 'AbortError')))
    }

    const timer = setTimeout(() => {
      if (child.pid) kill(child.pid)
      finish(() => reject(new Error(`Command timed out after ${timeoutMs}ms`)))
    }, timeoutMs)

    const cleanup = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort)

    child.stdout.on('data', (buf: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += buf.toString('utf8')
    })
    child.stderr.on('data', (buf: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += buf.toString('utf8')
    })

    child.on('error', (err) => {
      finish(() => reject(err))
    })

    child.on('close', (code) => {
      const findstrNoMatch = isWin && isFindstrNoMatch(command, code, stdout, stderr)
      const out = formatTerminalOutput(workspaceRoot, command, stdout, stderr, code, [
        findstrNoMatch ? 'findstr: no matches' : ''
      ])
      finish(() => resolve(out))
    })
  })
}

/** Exported for unit tests. */
export { unixShellInvocation }
