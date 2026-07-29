import type { UiToolRow } from '@shared/transcript'
import { parseArgsRecord } from '@shared/toolSummary'
import { parseTerminalOutput } from '@shared/utils/terminalFormat'

export type TerminalCardData = {
  command: string
  exitCode: number | null
  cwd: string
  output: string
  stderr: string
}

export function parseTerminalCardData(tool: UiToolRow): TerminalCardData {
  const args = parseArgsRecord(tool.argsPreview)
  const command =
    typeof args?.command === 'string'
      ? args.command
      : typeof args?.cmd === 'string'
        ? args.cmd
        : tool.summary || ''

  const { cwd, stdout, stderr, exitCode } = parseTerminalOutput(tool.content ?? '')

  return { command, exitCode, cwd, output: stdout, stderr }
}
