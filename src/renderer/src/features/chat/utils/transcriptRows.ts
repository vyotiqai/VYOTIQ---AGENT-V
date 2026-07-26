import type { UiItem, UiToolApproval } from '@shared/transcript'
import { duplicatesReasoning, isMeaningfulThinking, stripToolShapedAssistantText } from '@shared/transcript'
import { parseArgsRecord } from '@shared/toolSummary'
import { countDiffLines, countLines, parseEditCardData } from './toolCardData'

export type MessageItem = Extract<UiItem, { kind: 'message' }>
export type UserItem = MessageItem & { role: 'user' }
export type AssistantItem = MessageItem & { role: 'assistant' }
export type ToolItem = Extract<UiItem, { kind: 'tool' }>

export type TranscriptRow =
  | { kind: 'user'; id: string; item: UserItem; turnIndex: number }
  | { kind: 'turn'; id: string; turnIndex: number; span: TurnSpan }
  | { kind: 'thinking'; id: string; item: AssistantItem; turnIndex: number }
  /** `final` marks the turn's closing answer, the one that earns a footer. */
  | { kind: 'text'; id: string; item: AssistantItem; turnIndex: number; final: boolean }
  | { kind: 'activity'; id: string; tools: ToolItem[]; turnIndex: number }
  | { kind: 'card'; id: string; item: ToolItem; turnIndex: number }
  | { kind: 'changes'; id: string; turnIndex: number; files: ChangedFile[] }
  | { kind: 'approval'; id: string; approval: UiToolApproval; turnIndex: number }

export type ChangedFile = {
  path: string
  added: number
  removed: number
}

export type TurnSpan = {
  startedAt: number | null
  endedAt: number | null
  /** Still producing output, so any duration is provisional. */
  active: boolean
}

/**
 * Rows a turn summary stands for, and therefore hides when it is collapsed.
 * Mid-turn narration is part of the work; only the closing answer survives.
 */
export function isTurnWorkRow(row: TranscriptRow): boolean {
  if (
    row.kind === 'thinking' ||
    row.kind === 'activity' ||
    row.kind === 'card' ||
    row.kind === 'approval'
  ) {
    return true
  }
  return row.kind === 'text' && !row.final
}

/** Tools whose output is worth a dedicated card instead of a group line. */
const CARD_TOOLS = new Set([
  'terminal',
  'edit',
  'multi_edit',
  'todo_write',
  'subagent',
  'delete'
])

/** Extra lead-in above a user prompt that opens a new turn (matches TRANSCRIPT_TURN_GAP). */
export const TURN_GAP_PX = 24

function isCardTool(item: ToolItem): boolean {
  return CARD_TOOLS.has(item.tool.name)
}

/**
 * Build turn-aware transcript rows.
 *
 * Consecutive lookup-style calls collapse into one activity row, while a call
 * whose output is the point — a command, an edit — breaks out into its own card
 * where the reader can see it without opening anything. Assistant narration
 * stays where it happened, which also separates the groups on either side of it.
 */
export function buildTranscriptRows(items: UiItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let turnIndex = -1
  let pending: ToolItem[] = []

  const flush = (): void => {
    const run = pending
    pending = []
    let group: ToolItem[] = []

    const closeGroup = (): void => {
      if (!group.length) return
      rows.push({ kind: 'activity', id: `activity:${group[0]!.id}`, tools: group, turnIndex })
      group = []
    }

    const emitTool = (item: ToolItem): void => {
      // A gated call waits on the reader — show only the approval card, not a
      // parallel "Working…" tool chrome for the same call.
      if (item.approval) {
        closeGroup()
        rows.push({
          kind: 'approval',
          id: `approval:${item.approval.requestId}`,
          approval: item.approval,
          turnIndex: Math.max(turnIndex, 0)
        })
        return
      }
      if (isCardTool(item)) {
        closeGroup()
        rows.push({ kind: 'card', id: item.id, item, turnIndex })
        return
      }
      group.push(item)
    }

    for (const item of run) {
      emitTool(item)
    }
    closeGroup()
  }

  for (const item of items) {
    if (item.kind === 'tool') {
      pending.push(item)
      continue
    }

    if (item.role === 'user') {
      flush()
      turnIndex += 1
      rows.push({ kind: 'user', id: item.id, item: item as UserItem, turnIndex })
      continue
    }

    const assistant = item as AssistantItem
    const showThinking = isMeaningfulThinking(assistant.thinking)
    const cleanedContent = stripToolShapedAssistantText(assistant.content)
    const showContent = Boolean(
      cleanedContent && !duplicatesReasoning({ ...assistant, content: cleanedContent })
    )
    // A row with nothing to show must not split the stretch around it, or the
    // transcript stacks identical group headers with no separator between them.
    if (!showThinking && !showContent) continue

    flush()
    if (showThinking) {
      rows.push({ kind: 'thinking', id: `${assistant.id}:thinking`, item: assistant, turnIndex })
    }
    if (showContent) {
      rows.push({
        kind: 'text',
        id: assistant.id,
        item: cleanedContent === assistant.content ? assistant : { ...assistant, content: cleanedContent },
        turnIndex,
        final: false
      })
    }
  }

  flush()
  // Turn summaries stand for the work rows, and which text row is the closing
  // answer decides what counts as work, so that has to be settled first.
  return withChangeSummaries(withTurnSummaries(markFinalText(rows)))
}

/** Tools that write files, and so contribute to a turn's change summary. */
const WRITING_TOOLS = new Set(['edit', 'multi_edit'])

function writingToolChanges(item: ToolItem): ChangedFile[] {
  if (!WRITING_TOOLS.has(item.tool.name) || item.tool.status !== 'done') return []

  if (item.tool.name === 'multi_edit') {
    const args = parseArgsRecord(item.tool.argsPreview)
    const edits = args?.edits
    if (!Array.isArray(edits)) return []
    const out: ChangedFile[] = []
    for (const entry of edits) {
      if (!entry || typeof entry !== 'object') continue
      const edit = entry as Record<string, unknown>
      const path = typeof edit.path === 'string' ? edit.path : ''
      if (!path) continue
      if (typeof edit.contents === 'string') {
        const added = countLines(edit.contents)
        if (added > 0) out.push({ path, added, removed: 0 })
        continue
      }
      if (typeof edit.diff === 'string' && edit.diff.trim()) {
        const { added, removed } = countDiffLines(edit.diff)
        if (added > 0 || removed > 0) out.push({ path, added, removed })
      }
    }
    return out
  }

  const { path, added, removed } = parseEditCardData(item.tool)
  if (!path || (added === 0 && removed === 0)) return []
  return [{ path, added, removed }]
}

function turnToolItems(row: TranscriptRow): ToolItem[] {
  if (row.kind === 'card') return [row.item]
  if (row.kind === 'activity') return row.tools
  return []
}

/**
 * Close a turn that touched several files with a rollup of what changed.
 *
 * A single edit already has its own card right there in the transcript, so the
 * rollup only earns its space once the edits are spread across the turn.
 */
function withChangeSummaries(rows: TranscriptRow[]): TranscriptRow[] {
  const out: TranscriptRow[] = []
  let turnIndex: number | null = null
  let totals = new Map<string, ChangedFile>()

  const closeTurn = (): void => {
    if (turnIndex != null && totals.size > 1) {
      out.push({
        kind: 'changes',
        id: `changes:${turnIndex}`,
        turnIndex,
        files: [...totals.values()]
      })
    }
    totals = new Map()
  }

  for (const row of rows) {
    if (row.turnIndex !== turnIndex) {
      closeTurn()
      turnIndex = row.turnIndex
    }
    out.push(row)

    for (const item of turnToolItems(row)) {
      for (const change of writingToolChanges(item)) {
        const existing = totals.get(change.path)
        if (existing) {
          existing.added += change.added
          existing.removed += change.removed
        } else {
          totals.set(change.path, { ...change })
        }
      }
    }
  }

  closeTurn()
  return out
}

/** Only the last answer of a turn is "the reply"; earlier ones are steps toward it. */
function markFinalText(rows: TranscriptRow[]): TranscriptRow[] {
  const lastByTurn = new Map<number, number>()
  rows.forEach((row, index) => {
    if (row.kind === 'text') lastByTurn.set(row.turnIndex, index)
  })
  if (lastByTurn.size === 0) return rows

  return rows.map((row, index) =>
    row.kind === 'text' ? { ...row, final: lastByTurn.get(row.turnIndex) === index } : row
  )
}

function toMs(iso: string | undefined): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? null : ms
}

function rowTimestamps(row: TranscriptRow): { at: number | null; endedAt: number | null } {
  switch (row.kind) {
    case 'user':
    case 'thinking':
    case 'text':
      return { at: toMs(row.item.at), endedAt: null }
    case 'card':
      return { at: toMs(row.item.at), endedAt: row.item.groupTiming?.endedAt ?? null }
    case 'activity': {
      let at: number | null = null
      let endedAt: number | null = null
      for (const tool of row.tools) {
        const started = toMs(tool.at) ?? tool.groupTiming?.startedAt ?? null
        if (started != null) at = at == null ? started : Math.min(at, started)
        const ended = tool.groupTiming?.endedAt ?? null
        if (ended != null) endedAt = endedAt == null ? ended : Math.max(endedAt, ended)
      }
      return { at, endedAt }
    }
    case 'turn':
    case 'changes':
    case 'approval':
      return { at: null, endedAt: null }
  }
}

function isRowActive(row: TranscriptRow): boolean {
  switch (row.kind) {
    case 'thinking':
    case 'text':
      return row.item.streaming === true || row.item.thinkingStreaming === true
    case 'card':
      return row.item.tool.status === 'running'
    case 'activity':
      return row.tools.some((tool) => tool.tool.status === 'running')
    default:
      return false
  }
}

/**
 * Prefix each turn that did some work with a summary of how long it took.
 *
 * The span runs from the prompt to the last thing the turn produced, which is
 * the interval a reader means by "how long did that take" — not the sum of the
 * individual tool durations, which would exclude the model's own thinking.
 */
function withTurnSummaries(rows: TranscriptRow[]): TranscriptRow[] {
  const out: TranscriptRow[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    out.push(row)
    if (row.kind !== 'user') continue

    const turn: TranscriptRow[] = []
    for (let j = i + 1; j < rows.length && rows[j]!.turnIndex === row.turnIndex; j++) {
      turn.push(rows[j]!)
    }
    if (!turn.some(isTurnWorkRow)) continue

    const startedAt = toMs(row.item.at)
    let endedAt: number | null = null
    for (const entry of turn) {
      const { at, endedAt: closed } = rowTimestamps(entry)
      for (const candidate of [at, closed]) {
        if (candidate != null) endedAt = endedAt == null ? candidate : Math.max(endedAt, candidate)
      }
    }

    out.push({
      kind: 'turn',
      id: `turn:${row.id}`,
      turnIndex: row.turnIndex,
      span: { startedAt, endedAt, active: turn.some(isRowActive) }
    })
  }

  return out
}

/** Leading space a row reserves for turn separation. */
export function rowLeadingGap(row: TranscriptRow): number {
  return row.kind === 'user' && row.turnIndex > 0 ? TURN_GAP_PX : 0
}
