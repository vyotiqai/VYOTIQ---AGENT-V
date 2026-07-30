import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import {
  createPtySession,
  disposeAllPtySessions,
  disposePtySessionsForWorkspace,
  killPty,
  listPtySessions,
  resizePty,
  writePty
} from '@main/app/ptySessions'

vi.mock('@main/settings/settings', () => ({
  getSettings: () => ({ terminalShell: 'cmd' })
}))

vi.mock('@main/agent/tools/terminal', () => ({
  resolveTerminalShell: () => 'cmd'
}))

function fakeWindow(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() }
  } as unknown as BrowserWindow
}

describe('ptySessions', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    disposeAllPtySessions()
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  it('starts with no sessions', () => {
    expect(listPtySessions()).toEqual([])
  })

  it('killPty returns false for unknown ids', () => {
    expect(killPty('missing-id')).toBe(false)
  })

  it('disposeAllPtySessions is safe when empty', () => {
    expect(() => disposeAllPtySessions()).not.toThrow()
    expect(listPtySessions()).toEqual([])
  })

  it('resizePty rejects tiny dimensions and unknown ids', () => {
    expect(resizePty('missing', 1, 24)).toBe(false)
    expect(resizePty('missing', 80, 0)).toBe(false)
  })

  it('scopes list and dispose to workspace cwd', () => {
    const win = fakeWindow()
    const dirA = mkdtempSync(join(tmpdir(), 'vyotiq-pty-a-'))
    const dirB = mkdtempSync(join(tmpdir(), 'vyotiq-pty-b-'))
    tempDirs.push(dirA, dirB)
    const a = createPtySession({ cwd: dirA, cols: 80, rows: 24, sendTo: win })
    const b = createPtySession({ cwd: dirB, cols: 80, rows: 24, sendTo: win })
    expect(listPtySessions()).toHaveLength(2)
    expect(listPtySessions(dirA).map((s) => s.id)).toEqual([a.id])
    expect(listPtySessions(dirB).map((s) => s.id)).toEqual([b.id])
    expect(disposePtySessionsForWorkspace(dirA)).toBe(1)
    expect(listPtySessions().map((s) => s.id)).toEqual([b.id])
    expect(writePty(a.id, 'x')).toBe(false)
    expect(writePty(b.id, 'x')).toBe(true)
  })
})
