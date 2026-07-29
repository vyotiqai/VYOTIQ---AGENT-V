import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  pollTerminalSession,
  resetTerminalSessionsForTests,
  startBackgroundTerminal
} from '@main/agent/tools/terminalSessions'

describe('terminalSessions', () => {
  let cwd: string

  afterEach(() => {
    resetTerminalSessionsForTests()
    if (cwd) rmSync(cwd, { recursive: true, force: true })
  })

  it('starts a background command and polls until done', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'vyotiq-term-'))
    const signal = new AbortController().signal
    const command =
      process.platform === 'win32' ? 'cmd /c echo hello-bg' : 'echo hello-bg'

    const first = await startBackgroundTerminal({
      workspaceRoot: cwd,
      command,
      signal,
      shell: process.platform === 'win32' ? 'cmd' : 'auto',
      blockUntilMs: 5_000
    })
    expect(first).toMatch(/session_id:/)
    expect(first).toMatch(/hello-bg/)

    const sessionId = first.match(/^session_id:\s*(\S+)/m)?.[1]
    expect(sessionId).toBeTruthy()

    const polled = await pollTerminalSession({
      sessionId: sessionId!,
      blockUntilMs: 2_000,
      signal
    })
    expect(polled).toContain(sessionId!)
    expect(polled).toMatch(/status:\s*(done|pattern_matched)/)
  }, 15_000)
})
