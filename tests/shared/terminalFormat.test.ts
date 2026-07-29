import { describe, expect, it } from 'vitest'
import { parseTerminalOutput } from '@shared/utils/terminalFormat'

describe('parseTerminalOutput', () => {
  it('splits cwd, stdout, stderr, and exit code', () => {
    const parsed = parseTerminalOutput(
      'cwd: /ws\n\nbuild output\nstderr:\nerror line\nexit_code: 1'
    )
    expect(parsed.cwd).toBe('/ws')
    expect(parsed.stdout).toContain('build output')
    expect(parsed.stderr).toContain('error line')
    expect(parsed.exitCode).toBe(1)
  })

  it('handles stdout-only success', () => {
    const parsed = parseTerminalOutput('cwd: /ws\n\nok\nexit_code: 0')
    expect(parsed.stdout).toBe('ok')
    expect(parsed.stderr).toBe('')
    expect(parsed.exitCode).toBe(0)
  })
})
