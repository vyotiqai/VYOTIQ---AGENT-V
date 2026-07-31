import { execFile as execFileCb } from 'child_process'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { getSettings } from '@main/settings/settings'
import { sanitizedTerminalEnv } from './terminal'

const execFile = promisify(execFileCb)

const DIAG_TIMEOUT_MS = 120_000
const DIAG_MAX_BUFFER = 4 * 1024 * 1024
const DIAG_OUTPUT_CAP = 80_000
const MAX_DIAGNOSTICS = 80

export type DiagnosticsKind = 'typecheck' | 'lint'

export type DiagnosticItem = {
  file: string
  line: number
  col: number
  message: string
  severity?: string
}

function packageScripts(workspace: string): Record<string, string> {
  const pkgPath = join(workspace, 'package.json')
  if (!existsSync(pkgPath)) return {}
  try {
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
    return raw.scripts && typeof raw.scripts === 'object' ? raw.scripts : {}
  } catch {
    return {}
  }
}

function preferPnpm(workspace: string): boolean {
  return existsSync(join(workspace, 'pnpm-lock.yaml'))
}

/**
 * True when the workspace has something for `tsc` / a typecheck script to run.
 * Empty folders (and npm packages with only typescript installed) are not projects —
 * `tsc --noEmit` otherwise prints help and exits 1 (verified live session 81cee96f).
 */
export function hasTypeScriptProject(workspace: string): boolean {
  const scripts = packageScripts(workspace)
  if (scripts.typecheck || scripts['type-check']) return true
  if (existsSync(join(workspace, 'tsconfig.json'))) return true
  try {
    for (const name of readdirSync(workspace)) {
      if (/^tsconfig.*\.json$/i.test(name)) return true
    }
  } catch {
    // unreadable workspace → treat as no project
  }
  return false
}

function shellCommand(workspace: string, command: string): { bin: string; args: string[] } {
  if (process.platform === 'win32') {
    return { bin: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  const shell = process.env.SHELL || '/bin/bash'
  return { bin: shell, args: ['-lc', command] }
}

/** npm swallows package flags unless `--` is present; pnpm exec does not. */
export function execPackageCommand(pm: 'npm' | 'pnpm', pkg: string, pkgArgs: string): string {
  return pm === 'npm' ? `npm exec -- ${pkg} ${pkgArgs}` : `pnpm exec ${pkg} ${pkgArgs}`
}

export function resolveDiagnosticsCommand(workspace: string, kind: DiagnosticsKind): string {
  const settings = getSettings()
  const override = settings.diagnosticsCommand?.trim()
  if (override && kind === 'typecheck') return override

  const scripts = packageScripts(workspace)
  const pm = preferPnpm(workspace) ? 'pnpm' : 'npm'

  if (kind === 'lint') {
    if (scripts.lint) return `${pm} run lint --if-present`
    // Prefer JSON: ESLint 10 removed the built-in `unix` formatter.
    return execPackageCommand(pm, 'eslint', '. --format json')
  }

  if (scripts.typecheck) return `${pm} run typecheck`
  if (scripts['type-check']) return `${pm} run type-check`
  return execPackageCommand(pm, 'tsc', '--noEmit --pretty false')
}

/** Parse ESLint `--format json` output (array of file results). */
export function parseEslintJsonDiagnostics(text: string): DiagnosticItem[] | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const items: DiagnosticItem[] = []
  for (const file of parsed) {
    if (!file || typeof file !== 'object') continue
    const filePath = (file as { filePath?: unknown }).filePath
    const messages = (file as { messages?: unknown }).messages
    if (typeof filePath !== 'string' || !Array.isArray(messages)) continue
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue
      const m = msg as {
        line?: unknown
        column?: unknown
        severity?: unknown
        message?: unknown
        ruleId?: unknown
      }
      if (typeof m.message !== 'string') continue
      const severity =
        m.severity === 1 ? 'warning' : m.severity === 2 ? 'error' : 'error'
      const rule = typeof m.ruleId === 'string' && m.ruleId ? ` (${m.ruleId})` : ''
      items.push({
        file: filePath,
        line: typeof m.line === 'number' ? m.line : 1,
        col: typeof m.column === 'number' ? m.column : 1,
        severity,
        message: `${m.message}${rule}`
      })
      if (items.length >= MAX_DIAGNOSTICS) return items
    }
  }
  return items
}

/** Parse common tsc / eslint-unix style "file(line,col): error TS…: message" lines. */
export function parseDiagnosticLines(text: string): DiagnosticItem[] {
  const fromJson = parseEslintJsonDiagnostics(text)
  if (fromJson && fromJson.length > 0) return fromJson

  const items: DiagnosticItem[] = []
  const re =
    /^(.+?)\((\d+),(\d+)\):\s*(error|warning|info)?\s*(?:TS\d+:\s*)?(.+)$/i
  const reColon = /^(.+?):(\d+):(\d+):\s*(error|warning|info)?\s*(.+)$/i
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let m = re.exec(trimmed)
    if (!m) m = reColon.exec(trimmed)
    if (!m) continue
    items.push({
      file: m[1]!,
      line: Number(m[2]),
      col: Number(m[3]),
      severity: (m[4] || 'error').toLowerCase(),
      message: m[5]!.trim()
    })
    if (items.length >= MAX_DIAGNOSTICS) break
  }
  return items
}

export async function toolDiagnosticsAsync(
  workspace: string,
  kind: DiagnosticsKind,
  signal: AbortSignal
): Promise<{ ok: boolean; content: string }> {
  if (kind === 'typecheck') {
    const override = getSettings().diagnosticsCommand?.trim()
    if (!override && !hasTypeScriptProject(workspace)) {
      return {
        ok: true,
        content:
          'No TypeScript project (no tsconfig / typecheck script); typecheck skipped.'
      }
    }
  }

  const command = resolveDiagnosticsCommand(workspace, kind)
  const { bin, args } = shellCommand(workspace, command)
  try {
    const { stdout, stderr } = await execFile(bin, args, {
      cwd: workspace,
      encoding: 'utf8',
      timeout: DIAG_TIMEOUT_MS,
      maxBuffer: DIAG_MAX_BUFFER,
      windowsHide: true,
      env: sanitizedTerminalEnv(),
      signal
    })
    const combined = [stdout, stderr].filter(Boolean).join('\n').trim()
    const capped =
      combined.length > DIAG_OUTPUT_CAP
        ? combined.slice(0, DIAG_OUTPUT_CAP) + '\n… (output truncated)'
        : combined || '(no output)'
    const parsed = parseDiagnosticLines(combined)
    if (parsed.length > 0) {
      const lines = [
        `command: ${command}`,
        `diagnostics: ${parsed.length}${parsed.length >= MAX_DIAGNOSTICS ? '+' : ''}`,
        '',
        ...parsed.map(
          (d) =>
            `${d.file}:${d.line}:${d.col}: ${d.severity ?? 'error'}: ${d.message}`
        )
      ]
      return { ok: true, content: lines.join('\n') }
    }
    return { ok: true, content: [`command: ${command}`, '', capped].join('\n') }
  } catch (err) {
    if (signal.aborted) throw err
    const anyErr = err as { stdout?: string; stderr?: string; message?: string; code?: number }
    const combined = [anyErr.stdout, anyErr.stderr].filter(Boolean).join('\n').trim()
    const capped =
      combined.length > DIAG_OUTPUT_CAP
        ? combined.slice(0, DIAG_OUTPUT_CAP) + '\n… (output truncated)'
        : combined
    const parsed = parseDiagnosticLines(combined)
    if (parsed.length > 0) {
      const lines = [
        `command: ${command}`,
        `exit: ${anyErr.code ?? 'error'}`,
        `diagnostics: ${parsed.length}${parsed.length >= MAX_DIAGNOSTICS ? '+' : ''}`,
        '',
        ...parsed.map(
          (d) =>
            `${d.file}:${d.line}:${d.col}: ${d.severity ?? 'error'}: ${d.message}`
        )
      ]
      // Non-zero exit with parsed diagnostics is still useful output.
      return { ok: true, content: lines.join('\n') }
    }
    return {
      ok: false,
      content: [
        `command: ${command}`,
        anyErr.message ?? 'Diagnostics command failed',
        capped
      ]
        .filter(Boolean)
        .join('\n')
    }
  }
}
