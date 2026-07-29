import type { UiToolRow } from '@shared/transcript'
import { parseArgsRecord } from '@shared/toolSummary'
import type { DiffLine } from '../toolUi'
import { parseDiffPreview, parseEditCardData } from '../toolUi'
import type { TranscriptRow } from './transcriptRows'

const WRITING_TOOLS = new Set(['edit', 'multi_edit', 'str_replace', 'delete'])

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

function appendLines(
  map: Map<string, DiffLine[]>,
  path: string,
  lines: DiffLine[]
): void {
  if (!path || lines.length === 0) return
  const key = normalizePath(path)
  const existing = map.get(key)
  if (!existing) {
    map.set(key, lines)
    return
  }
  existing.push({ kind: 'gap', text: '', lineNumber: null }, ...lines)
}

function diffLinesByPath(tool: UiToolRow): Map<string, DiffLine[]> {
  const out = new Map<string, DiffLine[]>()
  if (!WRITING_TOOLS.has(tool.name)) return out

  if (tool.name === 'delete') {
    const args = parseArgsRecord(tool.argsPreview)
    const path = typeof args?.path === 'string' ? args.path : tool.summary?.trim() || ''
    if (path) out.set(normalizePath(path), [])
    return out
  }

  if (tool.name === 'multi_edit') {
    const args = parseArgsRecord(tool.argsPreview)
    const edits = args?.edits
    if (!Array.isArray(edits)) return out
    for (const entry of edits) {
      if (!entry || typeof entry !== 'object') continue
      const edit = entry as Record<string, unknown>
      const path = typeof edit.path === 'string' ? edit.path : ''
      if (!path) continue
      // Reuse single-edit preview by wrapping as a pseudo tool.
      const chunk = parseDiffPreview({
        ...tool,
        name: 'edit',
        argsPreview: JSON.stringify(edit)
      })
      appendLines(out, path, chunk)
    }
    return out
  }

  const { path } = parseEditCardData(tool)
  appendLines(out, path, parseDiffPreview(tool))
  return out
}

function mergeToolDiffs(
  target: Map<string, DiffLine[]>,
  source: Map<string, DiffLine[]>
): void {
  for (const [path, lines] of source) {
    appendLines(target, path, lines)
  }
}

/** Per-turn, per-path diff lines from writing tool args (for ChangeSummary expand). */
export function collectTurnFileDiffs(
  rows: readonly TranscriptRow[]
): Map<number, Map<string, DiffLine[]>> {
  const byTurn = new Map<number, Map<string, DiffLine[]>>()

  const ensure = (turnIndex: number): Map<string, DiffLine[]> => {
    let map = byTurn.get(turnIndex)
    if (!map) {
      map = new Map()
      byTurn.set(turnIndex, map)
    }
    return map
  }

  for (const row of rows) {
    if (row.kind === 'card') {
      if (row.item.tool.status !== 'done') continue
      mergeToolDiffs(ensure(row.turnIndex), diffLinesByPath(row.item.tool))
    } else if (row.kind === 'activity') {
      for (const toolItem of row.tools) {
        if (toolItem.tool.status !== 'done') continue
        mergeToolDiffs(ensure(row.turnIndex), diffLinesByPath(toolItem.tool))
      }
    }
  }

  return byTurn
}
