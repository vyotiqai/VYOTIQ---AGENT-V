import { execFile as execFileCb } from 'child_process'
import { existsSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { promisify } from 'util'
import { getSettings } from '@main/settings/settings'
import { resolveInsideWorkspace } from '../../workspace/safePath'
import { sanitizedTerminalEnv } from './terminal'

const execFile = promisify(execFileCb)

const DIAG_TIMEOUT_MS = 120_000
const DIAG_MAX_BUFFER = 4 * 1024 * 1024
const DIAG_OUTPUT_CAP = 80_000
const MAX_DIAGNOSTICS = 80
const MAX_READ_LINT_PATHS = 40

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

function normPathKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

/** Keep diagnostics whose file matches any workspace-relative path or directory prefix. */
export function filterDiagnosticsForPaths(
  items: DiagnosticItem[],
  workspaceRelativePaths: string[]
): DiagnosticItem[] {
  const keys = workspaceRelativePaths.map(normPathKey).filter(Boolean)
  if (keys.length === 0) return []
  return items.filter((item) => {
    const fileKey = normPathKey(item.file)
    return keys.some(
      (key) => fileKey === key || fileKey.endsWith(`/${key}`) || fileKey.startsWith(`${key}/`)
    )
  })
}

function formatDiagnosticItems(
  command: string,
  items: DiagnosticItem[],
  extraHeader?: string[]
): string {
  const lines = [
    `command: ${command}`,
    ...(extraHeader ?? []),
    `diagnostics: ${items.length}${items.length >= MAX_DIAGNOSTICS ? '+' : ''}`,
    '',
    ...items.map(
      (d) => `${d.file}:${d.line}:${d.col}: ${d.severity ?? 'error'}: ${d.message}`
    )
  ]
  return lines.join('\n')
}

async function runDiagCommand(
  workspace: string,
  command: string,
  signal: AbortSignal
): Promise<{ ok: boolean; combined: string; exitCode?: number; message?: string }> {
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
    return { ok: true, combined: [stdout, stderr].filter(Boolean).join('\n').trim() }
  } catch (err) {
    if (signal.aborted) throw err
    const anyErr = err as { stdout?: string; stderr?: string; message?: string; code?: number }
    return {
      ok: false,
      combined: [anyErr.stdout, anyErr.stderr].filter(Boolean).join('\n').trim(),
      exitCode: anyErr.code,
      message: anyErr.message
    }
  }
}

function resolveLintPathsCommand(workspace: string, relPaths: string[]): string | null {
  const scripts = packageScripts(workspace)
  const pm = preferPnpm(workspace) ? 'pnpm' : 'npm'
  const quoted = relPaths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ')
  // Prefer direct eslint on the scoped paths (fast). Package `lint` scripts are usually whole-tree.
  if (existsSync(join(workspace, 'node_modules', 'eslint')) || scripts.lint) {
    return `${pm} exec eslint ${quoted} -f unix`
  }
  return null
}

/**
 * File-scoped diagnostics: eslint on the given paths (when available) plus
 * project typecheck filtered to those paths.
 */
export async function toolReadLintsAsync(
  workspace: string,
  paths: string[],
  signal: AbortSignal
): Promise<{ ok: boolean; content: string }> {
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))]
  if (unique.length === 0) {
    return { ok: false, content: 'read_lints requires at least one path' }
  }
  if (unique.length > MAX_READ_LINT_PATHS) {
    return {
      ok: false,
      content: `Too many paths (max ${MAX_READ_LINT_PATHS}). Narrow the set or use diagnostics.`
    }
  }

  const relPaths: string[] = []
  for (const pathArg of unique) {
    try {
      const resolved = resolveInsideWorkspace(workspace, pathArg)
      const rel = relative(workspace, resolved).replace(/\\/g, '/')
      if (!rel || rel.startsWith('..')) {
        return { ok: false, content: `Path escapes workspace: ${pathArg}` }
      }
      if (!existsSync(resolved)) {
        return { ok: false, content: `Path not found: ${rel}` }
      }
      const st = statSync(resolved)
      if (!st.isFile() && !st.isDirectory()) {
        return { ok: false, content: `Not a file or directory: ${rel}` }
      }
      relPaths.push(rel)
    } catch (err) {
      return {
        ok: false,
        content: err instanceof Error ? err.message : `Invalid path: ${pathArg}`
      }
    }
  }

  const collected: DiagnosticItem[] = []
  const commands: string[] = []
  const notes: string[] = []

  const lintCmd = resolveLintPathsCommand(workspace, relPaths)
  if (lintCmd) {
    commands.push(lintCmd)
    const lintRun = await runDiagCommand(workspace, lintCmd, signal)
    throwIfAborted(signal)
    const lintItems = filterDiagnosticsForPaths(parseDiagnosticLines(lintRun.combined), relPaths)
    collected.push(...lintItems)
    if (!lintRun.ok && lintItems.length === 0 && lintRun.combined) {
      notes.push(`lint note: exit ${lintRun.exitCode ?? 'error'} (no parseable diagnostics)`)
    }
  } else {
    notes.push('lint: skipped (no eslint / lint script detected)')
  }

  const typeCmd = resolveCommand(workspace, 'typecheck')
  commands.push(typeCmd)
  const typeRun = await runDiagCommand(workspace, typeCmd, signal)
  throwIfAborted(signal)
  const typeItems = filterDiagnosticsForPaths(parseDiagnosticLines(typeRun.combined), relPaths)
  collected.push(...typeItems)

  const seen = new Set<string>()
  const deduped: DiagnosticItem[] = []
  for (const item of collected) {
    const key = `${normPathKey(item.file)}:${item.line}:${item.col}:${item.message}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
    if (deduped.length >= MAX_DIAGNOSTICS) break
  }

  if (deduped.length > 0) {
    return {
      ok: true,
      content: formatDiagnosticItems(commands.join(' ; '), deduped, [
        `paths: ${relPaths.join(', ')}`,
        ...notes
      ])
    }
  }

  if (!typeRun.ok && !typeRun.combined && !lintCmd) {
    return {
      ok: false,
      content: [
        `paths: ${relPaths.join(', ')}`,
        `command: ${commands.join(' ; ')}`,
        typeRun.message ?? 'Diagnostics command failed'
      ].join('\n')
    }
  }

  return {
    ok: true,
    content: [
      `paths: ${relPaths.join(', ')}`,
      `command: ${commands.join(' ; ')}`,
      ...notes,
      'diagnostics: 0',
      '',
      'No diagnostics for the given paths.'
    ].join('\n')
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('Aborted')
    err.name = 'AbortError'
    throw err
  }
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
