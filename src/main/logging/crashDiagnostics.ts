import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

/** Decode Windows exit codes as unsigned NTSTATUS hex for crash logs. */
export function formatWindowsExitCode(exitCode: number): string | undefined {
  if (process.platform !== 'win32') return undefined
  const unsigned = exitCode >>> 0
  return `0x${unsigned.toString(16).toUpperCase().padStart(8, '0')}`
}

/** Reasons where reloading the renderer is safe and usually restores the UI. */
export function shouldReloadRendererAfterCrash(reason: string): boolean {
  return (
    reason === 'crashed' ||
    reason === 'oom' ||
    reason === 'memory-eviction' ||
    reason === 'launch-failed'
  )
}

/** Count Crashpad minidump files currently on disk (best-effort). */
export function countCrashpadReports(crashDumpsDir: string): number {
  const reportsDir = join(crashDumpsDir, 'reports')
  if (!existsSync(reportsDir)) return 0
  try {
    return readdirSync(reportsDir).filter((name) => /\.dmp$/i.test(name)).length
  } catch {
    return 0
  }
}

/** Redact workspace paths from a renderer URL before logging. */
export function sanitizeCrashUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'file:') return 'file://[app]'
    if (parsed.protocol === 'devtools:') return 'devtools:'
    return `${parsed.protocol}//${parsed.host || '[app]'}`
  } catch {
    return trimmed.includes(':\\') || trimmed.startsWith('/') ? '[url]' : trimmed.slice(0, 120)
  }
}
