import { parseCompactionJson } from '../schemas/compaction'
import type { CompactionRecord } from './types'
import { readMemoryFile, writeMemoryFile } from './memory'

const PROMOTE_CAP = 2000

const FREEFORM_SECTIONS = [
  'Session Intent',
  'Files Touched',
  'Key Decisions',
  'Constraints',
  'Open Bugs/Blockers',
  'Next Steps'
] as const

function dedupeLines(existing: string, additions: string[]): string {
  const seen = new Set(
    existing
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  )
  const out = existing.trimEnd() ? [existing.trimEnd()] : []
  for (const line of additions) {
    const trimmed = line.trim()
    if (!trimmed || seen.has(trimmed)) continue
    const formatted = trimmed.startsWith('-') ? trimmed : `- ${trimmed}`
    if (seen.has(formatted)) continue
    seen.add(trimmed)
    seen.add(formatted)
    out.push(formatted)
  }
  return out.join('\n').slice(0, PROMOTE_CAP)
}

function parseFreeformSections(summary: string): Partial<Record<(typeof FREEFORM_SECTIONS)[number], string[]>> {
  const out: Partial<Record<(typeof FREEFORM_SECTIONS)[number], string[]>> = {}
  let current: (typeof FREEFORM_SECTIONS)[number] | null = null
  for (const line of summary.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/)
    if (heading) {
      const name = FREEFORM_SECTIONS.find(
        (s) => s.toLowerCase() === heading[1].trim().toLowerCase()
      )
      current = name ?? null
      continue
    }
    const trimmed = line.trim()
    if (!current || !trimmed || trimmed.startsWith('#')) continue
    const bullet = trimmed.replace(/^[-*]\s*/, '').trim()
    if (!bullet) continue
    out[current] = out[current] ?? []
    out[current]!.push(bullet)
  }
  return out
}

function promoteStructuredData(
  workspacePath: string,
  data: {
    sessionIntent?: string
    filesTouched: string[]
    keyDecisions: string[]
    constraints: string[]
    openBlockers: string[]
    nextSteps: string[]
  }
): void {
  const indexLines: string[] = []
  if (data.sessionIntent) indexLines.push(`Session: ${data.sessionIntent}`)
  for (const f of data.filesTouched.slice(0, 10)) indexLines.push(`File: ${f}`)
  for (const s of data.nextSteps.slice(0, 5)) indexLines.push(`Next: ${s}`)

  if (indexLines.length) {
    let index = ''
    try {
      index = readMemoryFile(workspacePath, 'index.md')
    } catch {
      index = '# Memory index\n'
    }
    writeMemoryFile(workspacePath, 'index.md', dedupeLines(index, indexLines))
  }

  const stateLines: string[] = []
  for (const d of data.keyDecisions.slice(0, 8)) stateLines.push(d)
  for (const c of data.constraints.slice(0, 5)) stateLines.push(`Constraint: ${c}`)
  for (const b of data.openBlockers.slice(0, 5)) stateLines.push(`Blocker: ${b}`)

  if (stateLines.length) {
    let state = ''
    try {
      state = readMemoryFile(workspacePath, 'state.md')
      if (state.startsWith('(')) state = ''
    } catch {
      state = ''
    }
    const header = state.trim() ? state : '# Workspace state\n'
    writeMemoryFile(workspacePath, 'state.md', dedupeLines(header, stateLines))
  }
}

/** Promote structured compaction facts into file-backed memory (conservative, deduped). */
export function promoteCompactionToMemory(
  workspacePath: string,
  record: CompactionRecord
): void {
  const parsed = parseCompactionJson(record.summary)
  if (parsed.structured) {
    promoteStructuredData(workspacePath, parsed.structured)
    return
  }

  const sections = parseFreeformSections(record.summary)
  const hasSections = Object.keys(sections).length > 0
  if (hasSections) {
    promoteStructuredData(workspacePath, {
      sessionIntent: sections['Session Intent']?.[0],
      filesTouched: sections['Files Touched'] ?? [],
      keyDecisions: sections['Key Decisions'] ?? [],
      constraints: sections['Constraints'] ?? [],
      openBlockers: sections['Open Bugs/Blockers'] ?? [],
      nextSteps: sections['Next Steps'] ?? []
    })
    return
  }

  if (!record.summary.trim()) return
  const date = record.createdAt.slice(0, 10)
  const notePath = `notes/compaction-${date}.md`
  try {
    writeMemoryFile(workspacePath, notePath, record.summary.trim())
  } catch {
    // best-effort
  }
}
