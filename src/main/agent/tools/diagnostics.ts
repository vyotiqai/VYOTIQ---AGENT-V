import { execFile as execFileCb } from 'child_process'
import { existsSync, readFileSync } from 'fs'
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

function shellCommand(workspace: string, command: string): { bin: string; args: string[] } {
  if (process.platform === 'win32') {
    return { bin: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  const shell = process.env.SHELL || '/bin/bash'
  return { bin: shell, args: ['-lc', command] }
}

function resolveCommand(workspace: string, kind: DiagnosticsKind): string {
  const settings = getSettings()
  const override = settings.diagnosticsCommand?.trim()
  if (override && kind === 'typecheck') return override

  const scripts = packageScripts(workspace)
  const pm = preferPnpm(workspace) ? 'pnpm' : 'npm'

  if (kind === 'lint') {
    if (scripts.lint) return `${pm} run lint --if-present`
    return `${pm} exec eslint . -f unix`
  }

  if (scripts.typecheck) return `${pm} run typecheck`
  if (scripts['type-check']) return `${pm} run type-check`
  return `${pm} exec tsc --noEmit --pretty false`
}

/** Parse common tsc / eslint-unix style "file(line,col): error TS…: message" lines. */
export function parseDiagnosticLines(text: string): DiagnosticItem[] {
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
  const command = resolveCommand(workspace, kind)
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
