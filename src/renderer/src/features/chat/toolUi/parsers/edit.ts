import type { UiToolRow } from '@shared/transcript'
import { parseArgsRecord } from '@shared/toolSummary'
import { countLines, splitLines } from './common'

export { countLines, splitLines } from './common'

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
  lineNumber: number | null
}

export function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

function changeLabelFor(added: number, removed: number): string {
  const parts: string[] = []
  if (added > 0) parts.push(`+${added}`)
  if (removed > 0) parts.push(`-${removed}`)
  return parts.join(' ')
}

function parseMultiEditCardData(
  args: Record<string, unknown> | null,
  summary: string | undefined
): EditCardData | null {
  const edits = args?.edits
  if (!Array.isArray(edits) || edits.length === 0) return null

  let added = 0
  let removed = 0
  const paths: string[] = []
  for (const entry of edits) {
    if (!entry || typeof entry !== 'object') continue
    const edit = entry as Record<string, unknown>
    if (typeof edit.path === 'string' && edit.path.trim()) paths.push(edit.path)
    if (typeof edit.contents === 'string') {
      added += countLines(edit.contents)
      continue
    }
    if (typeof edit.diff === 'string' && edit.diff.trim()) {
      const counts = countDiffLines(edit.diff)
      added += counts.added
      removed += counts.removed
    }
  }

  const path =
    paths.length > 1
      ? summary?.trim() || paths.join(', ')
      : paths[0] ?? (summary?.trim() || 'file')
  return { path, added, removed, changeLabel: changeLabelFor(added, removed) }
}

export function parseEditCardData(tool: UiToolRow): EditCardData {
  const args = parseArgsRecord(tool.argsPreview)
  const fromEdits = parseMultiEditCardData(args, tool.summary)
  if (fromEdits) return fromEdits

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

function diffLinesFromEditArgs(args: Record<string, unknown>): DiffLine[] {
  if (typeof args.contents === 'string') {
    return splitLines(args.contents).map((text, index) => ({
      kind: 'add' as const,
      text,
      lineNumber: index + 1
    }))
  }

  const diff = typeof args.diff === 'string' ? args.diff : ''
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

export function parseDiffPreview(tool: UiToolRow): DiffLine[] {
  const args = parseArgsRecord(tool.argsPreview)
  const edits = args?.edits
  if (Array.isArray(edits) && edits.length > 0) {
    const out: DiffLine[] = []
    for (const entry of edits) {
      if (!entry || typeof entry !== 'object') continue
      const edit = entry as Record<string, unknown>
      const chunk = diffLinesFromEditArgs(edit)
      if (!chunk.length) continue
      if (out.length > 0) out.push({ kind: 'gap', text: '', lineNumber: null })
      if (typeof edit.path === 'string' && edit.path.trim()) {
        out.push({ kind: 'context', text: edit.path, lineNumber: null })
      }
      out.push(...chunk)
    }
    return out
  }
  return diffLinesFromEditArgs(args ?? {})
}

export type FileChange = { path: string; added: number; removed: number }

function changeFromEditArgs(edit: Record<string, unknown>): FileChange | null {
  const path = typeof edit.path === 'string' ? edit.path : ''
  if (!path) return null
  if (typeof edit.contents === 'string') {
    const added = countLines(edit.contents)
    if (added > 0) return { path, added, removed: 0 }
    return null
  }
  if (typeof edit.diff === 'string' && edit.diff.trim()) {
    const { added, removed } = countDiffLines(edit.diff)
    if (added > 0 || removed > 0) return { path, added, removed }
  }
  return null
}

/** Per-file line deltas for turn change summaries. */
export function collectWritingChanges(tool: UiToolRow): FileChange[] {
  const args = parseArgsRecord(tool.argsPreview)
  if (tool.name === 'multi_edit') {
    const edits = args?.edits
    if (!Array.isArray(edits)) return []
    const out: FileChange[] = []
    for (const entry of edits) {
      if (!entry || typeof entry !== 'object') continue
      const change = changeFromEditArgs(entry as Record<string, unknown>)
      if (change) out.push(change)
    }
    return out
  }
  const { path, added, removed } = parseEditCardData(tool)
  if (!path || (added === 0 && removed === 0)) return []
  return [{ path, added, removed }]
}
