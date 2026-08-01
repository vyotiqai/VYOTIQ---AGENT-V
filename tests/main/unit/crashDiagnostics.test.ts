import { describe, expect, it } from 'vitest'
import {
  countCrashpadReports,
  formatWindowsExitCode,
  sanitizeCrashUrl,
  shouldReloadRendererAfterCrash
} from '@main/logging/crashDiagnostics'

describe('formatWindowsExitCode', () => {
  it('formats signed exit codes as unsigned hex on Windows', () => {
    const prev = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    expect(formatWindowsExitCode(-1)).toBe('0xFFFFFFFF')
    expect(formatWindowsExitCode(-1073741819)).toBe('0xC0000005')
    Object.defineProperty(process, 'platform', { value: prev })
  })

  it('returns undefined on non-Windows platforms', () => {
    const prev = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    expect(formatWindowsExitCode(-1)).toBeUndefined()
    Object.defineProperty(process, 'platform', { value: prev })
  })
})

describe('shouldReloadRendererAfterCrash', () => {
  it('reloads for native crash reasons', () => {
    expect(shouldReloadRendererAfterCrash('crashed')).toBe(true)
    expect(shouldReloadRendererAfterCrash('oom')).toBe(true)
    expect(shouldReloadRendererAfterCrash('memory-eviction')).toBe(true)
    expect(shouldReloadRendererAfterCrash('launch-failed')).toBe(true)
  })

  it('does not reload for intentional shutdown reasons', () => {
    expect(shouldReloadRendererAfterCrash('killed')).toBe(false)
    expect(shouldReloadRendererAfterCrash('clean-exit')).toBe(false)
    expect(shouldReloadRendererAfterCrash('abnormal-exit')).toBe(false)
  })
})

describe('sanitizeCrashUrl', () => {
  it('redacts file URLs and keeps safe origins', () => {
    expect(sanitizeCrashUrl('file:///C:/Users/me/project/index.html')).toBe('file://[app]')
    expect(sanitizeCrashUrl('https://example.com/chat')).toBe('https://example.com')
    expect(sanitizeCrashUrl('devtools://devtools/bundled/devtools_app.html')).toBe('devtools:')
  })
})

describe('countCrashpadReports', () => {
  it('returns 0 when reports directory is missing', () => {
    expect(countCrashpadReports('/tmp/nonexistent-crashpad-dir')).toBe(0)
  })
})
