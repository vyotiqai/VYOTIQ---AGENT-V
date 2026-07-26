export type ParsedTerminalOutput = {
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
}

/** Strip cwd header injected by toolTerminal before parsing exit metadata. */
export function stripTerminalCwdHeader(content: string): string {
  return content.replace(/^cwd:.*\n\n?/m, '')
}

/**
 * Parse terminal tool result text into cwd, streams, and exit code.
 *
 * Format: `cwd: …`, optional stdout, optional `stderr:\n…`, trailing `exit_code: N`.
 */
export function parseTerminalOutput(content: string): ParsedTerminalOutput {
  const cwdMatch = content.match(/^cwd:\s*(.+)$/m)
  const cwd = cwdMatch?.[1]?.trim() ?? ''

  const body = stripTerminalCwdHeader(content)
  const codeMatch = body.match(/exit_code:\s*(-?\d+)\b/)
  const exitCode = codeMatch ? Number(codeMatch[1]) : null

  const stderrIdx = body.indexOf('stderr:\n')
  let stderr = ''
  let stdout = body

  if (stderrIdx >= 0) {
    stdout = body.slice(0, stderrIdx).trimEnd()
    const after = body.slice(stderrIdx + 'stderr:\n'.length)
    const exitIdx = after.search(/\nexit_code:\s*-?\d+\b/)
    stderr =
      exitIdx >= 0
        ? after.slice(0, exitIdx).trimEnd()
        : after.replace(/\nexit_code:\s*-?\d+\b.*$/s, '').trimEnd()
  } else {
    stdout = body.replace(/\n?exit_code:\s*-?\d+\b.*$/s, '').trimEnd()
  }

  return { cwd, stdout, stderr, exitCode }
}
