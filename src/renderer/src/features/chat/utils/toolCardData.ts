import type { UiToolRow } from '@shared/transcript'
import { TOOL_LABELS, parseArgsRecord } from '@shared/toolSummary'

export type TerminalCardData = {
  command: string
  exitCode: number | null
  output: string
  stderr: string
}

export type EditCardData = {
  path: string
  added: number
  removed: number
  changeLabel: string
}

export type DiffLineKind = 'add' | 'del' | 'context' | 'gap'

export type DiffLine = {
  kind: DiffLineKind
  text: string
  /** Line number in the file after the edit; absent for deletions and gaps. */
  lineNumber: number | null
}

function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

export function parseTerminalCardData(tool: UiToolRow): TerminalCardData {
  const args = parseArgsRecord(tool.argsPreview)
  const command =
    typeof args?.command === 'string'
      ? args.command
      : typeof args?.cmd === 'string'
        ? args.cmd
        : tool.summary || ''

  const content = tool.content ?? ''
  const exitMatch = content.match(/exit_code:\s*(-?\d+)/)
  const exitCode = exitMatch ? Number(exitMatch[1]) : null

  const stderrIdx = content.indexOf('stderr:\n')
  let stderr = ''
  let output = content
  if (stderrIdx >= 0) {
    const before = content.slice(0, stderrIdx).trimEnd()
    const after = content.slice(stderrIdx + 'stderr:\n'.length)
    const exitIdx = after.lastIndexOf('\nexit_code:')
    stderr = (exitIdx >= 0 ? after.slice(0, exitIdx) : after).trimEnd()
    output = before.replace(/\nexit_code:\s*-?\d+\s*$/, '').trimEnd()
  } else {
    output = content.replace(/\nexit_code:\s*-?\d+\s*$/, '').trimEnd()
  }

  output = output.replace(/^cwd:.*\n\n?/, '').trim()

  return { command, exitCode, output, stderr }
}

function countLines(text: string): number {
  if (!text) return 0
  return splitLines(text).length
}

export function parseEditCardData(tool: UiToolRow): EditCardData {
  const args = parseArgsRecord(tool.argsPreview)
  const path = typeof args?.path === 'string' ? args.path : tool.summary?.trim() || 'file'

  if (typeof args?.contents === 'string') {
    const added = countLines(args.contents)
    return { path, added, removed: 0, changeLabel: changeLabelFor(added, 0) }
  }

  if (typeof args?.diff === 'string' && args.diff.trim()) {
    const { added, removed } = countDiffLines(args.diff)
    return { path, added, removed, changeLabel: changeLabelFor(added, removed) }
  }

  return { path, added: 0, removed: 0, changeLabel: '' }
}

function changeLabelFor(added: number, removed: number): string {
  const parts: string[] = []
  if (added > 0) parts.push(`+${added}`)
  if (removed > 0) parts.push(`-${removed}`)
  return parts.join(' ')
}

export function parseDiffPreview(tool: UiToolRow): DiffLine[] {
  const args = parseArgsRecord(tool.argsPreview)

  if (typeof args?.contents === 'string') {
    return splitLines(args.contents).map((text, index) => ({
      kind: 'add' as const,
      text,
      lineNumber: index + 1
    }))
  }

  const diff = typeof args?.diff === 'string' ? args.diff : ''
  if (!diff.trim()) return []

  const out: DiffLine[] = []
  let lineNumber = 0

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue

    const hunk = raw.match(/^@@\s*-\d+(?:,\d+)?\s*\+(\d+)/)
    if (hunk) {
      if (out.length > 0) out.push({ kind: 'gap', text: '', lineNumber: null })
      lineNumber = Number(hunk[1])
      continue
    }

    if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), lineNumber })
      lineNumber += 1
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), lineNumber: null })
    } else if (raw.startsWith('\\')) {
      continue
    } else {
      out.push({ kind: 'context', text: raw.startsWith(' ') ? raw.slice(1) : raw, lineNumber })
      lineNumber += 1
    }
  }

  while (out.length > 0 && out[out.length - 1]!.kind === 'gap') out.pop()
  return out
}

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function toolCardVerb(name: string, status: UiToolRow['status']): string {
  const labels = TOOL_LABELS[name]
  if (!labels) return status === 'running' ? 'Running' : 'Done'
  return status === 'running' ? labels.running : labels.done
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

const BADGE_OVERRIDES: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  markdown: 'md',
  python: 'py',
  yaml: 'yml',
  shell: 'sh'
}

export function fileBadge(path: string): string | null {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = name.slice(dot + 1).toLowerCase()
  const shortened = BADGE_OVERRIDES[extension]
  if (shortened) return shortened
  return extension && extension.length <= 4 ? extension : null
}
