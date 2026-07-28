import type { UiItem, UiToolApproval } from '@shared/transcript'
import {
  duplicatesReasoning,
  mergeThinkingContent,
  MIN_VISIBLE_FINISHED_THINKING_CHARS,
  shouldRenderThinking,
  stripToolShapedAssistantText,
  stripToolShapedAssistantTextForStream
} from '@shared/transcript'
import { isProminentTool } from '../toolUi'
import { collectWritingChanges } from '../toolUi/parsers/edit'
import { parseDeleteData } from '../toolUi/parsers/delete'
import { deriveRunActivity, type RunActivityPhase } from './runActivity'
import { mapToolGroupProps } from './toolGroupAdapter'

export type { RunActivityPhase } from './runActivity'

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
  /** What the agent is doing while the turn is active. */
  activity?: RunActivityPhase | null
}

/**
 * Rows a turn summary stands for, and therefore hides when it is collapsed.
 * Mid-turn narration is part of the work; only the closing answer survives.
 * Approval prompts must stay visible — collapsing them deadlocks a running turn
 * (composer locked, no Allow/Deny).
 */
export function isTurnWorkRow(row: TranscriptRow): boolean {
  if (row.kind === 'approval') return false
  // Collapsed turns rely on TurnSummary for live phase; hide cards/activity so
  // running tools are not duplicated beside the timeline label.
  if (
    row.kind === 'thinking' ||
    row.kind === 'activity' ||
    row.kind === 'card'
  ) {
    return true
  }
  return row.kind === 'text' && !row.final
}

/** Tools whose output is worth a dedicated card instead of a group line. */
function isCardTool(item: ToolItem): boolean {
  if (item.tool.presentation) return item.tool.presentation === 'prominent'
  return isProminentTool(item.tool.name, item.tool.argsPreview)
}

/** Extra lead-in above a user prompt that opens a new turn (matches TRANSCRIPT_TURN_GAP). */
export const TURN_GAP_PX = 24

/**
 * Build turn-aware transcript rows.
 *
 * Consecutive lookup-style calls collapse into one activity row, while a call
 * whose output is the point — a command, an edit — breaks out into its own card
 * where the reader can see it without opening anything. Assistant narration
 * stays where it happened, which also separates the groups on either side of it.
 */
export function buildTranscriptRows(
  items: UiItem[],
  options?: { pendingRun?: boolean; running?: boolean; showThinking?: boolean }
): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let turnIndex = -1
  let pending: ToolItem[] = []
  const includeThinking = options?.showThinking !== false
  const hiddenThinkingStreamingTurns = new Set<number>()

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
    const showThinking =
      includeThinking &&
      shouldRenderThinking(assistant.thinking, assistant.thinkingStreaming)
    const cleanedContent = assistant.streaming
      ? stripToolShapedAssistantTextForStream(assistant.content)
      : stripToolShapedAssistantText(assistant.content)
    const showContent = Boolean(
      cleanedContent && !duplicatesReasoning({ ...assistant, content: cleanedContent })
    )
    if (!includeThinking && assistant.thinkingStreaming) {
      hiddenThinkingStreamingTurns.add(Math.max(turnIndex, 0))
    }
    // A row with nothing to show must not split the stretch around it, or the
    // transcript stacks identical group headers with no separator between them.
    if (!showThinking && !showContent) continue

    flush()
    if (showThinking) {
      const last = rows[rows.length - 1]
      if (
        last?.kind === 'thinking' &&
        last.turnIndex === turnIndex &&
        !last.item.thinkingStreaming &&
        !assistant.thinkingStreaming
      ) {
        const merged = mergeThinkingContent(
          [last.item.thinking, assistant.thinking].filter(Boolean) as string[]
        )
        rows[rows.length - 1] = {
          kind: 'thinking',
          id: last.id,
          item: { ...last.item, thinking: merged, thinkingStreaming: assistant.thinkingStreaming },
          turnIndex
        }
      } else {
        rows.push({ kind: 'thinking', id: `${assistant.id}:thinking`, item: assistant, turnIndex })
      }
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
  // Reasoning stays in step order (thinking → tools → thinking) — do not hoist
  // every step into one Thought at the top of the turn.
  return coalesceTurnWork(
    withChangeSummaries(
      withTurnSummaries(
        coalesceProminentCards(markFinalText(rows)),
        {
          pendingRun: options?.pendingRun,
          running: options?.running,
          hiddenThinkingStreamingTurns
        }
      )
    )
  )
}

/** Fingerprint of a row's visible content for React.memo identity reuse. */
export function transcriptRowFingerprint(row: TranscriptRow): string {
  switch (row.kind) {
    case 'user':
      return `user:${row.id}:${row.item.content.length}:${row.item.at ?? ''}`
    case 'turn':
      return `turn:${row.id}:${row.span.startedAt}:${row.span.endedAt}:${row.span.active}:${row.span.activity ?? ''}`
    case 'thinking':
      return `thinking:${row.id}:${row.item.thinking?.length ?? 0}:${row.item.thinkingStreaming ? 1 : 0}:${row.item.thinkingExpanded ?? ''}`
    case 'text':
      return `text:${row.id}:${row.item.content.length}:${row.item.streaming ? 1 : 0}:${row.final ? 1 : 0}`
    case 'activity':
      return `activity:${row.id}:${row.tools
        .map((t) => {
          const sub = t.subagent?.length ?? 0
          const subLast = t.subagent?.[t.subagent.length - 1]
          const usage = t.subagentContextUsage
          return [
            t.id,
            t.tool.status,
            t.tool.argsPreview?.length ?? 0,
            t.tool.content?.length ?? 0,
            t.tool.contentTruncated ? 1 : 0,
            t.tool.summary,
            t.groupExpanded ?? '',
            t.toolExpanded ?? '',
            sub,
            subLast ? `${subLast.kind}:${subLast.text.length}` : '',
            usage ? `${usage.step}:${usage.used}:${usage.updatedAt}` : ''
          ].join(':')
        })
        .join('|')}`
    case 'card': {
      const t = row.item
      const sub = t.subagent?.length ?? 0
      const subLast = t.subagent?.[t.subagent.length - 1]
      const usage = t.subagentContextUsage
      return [
        'card',
        row.id,
        t.tool.status,
        t.tool.argsPreview?.length ?? 0,
        t.tool.content?.length ?? 0,
        t.tool.contentTruncated ? 1 : 0,
        t.tool.summary,
        t.toolExpanded ?? '',
        t.groupExpanded ?? '',
        sub,
        subLast ? `${subLast.kind}:${subLast.text.length}` : '',
        usage ? `${usage.step}:${usage.used}:${usage.updatedAt}` : ''
      ].join(':')
    }
    case 'changes':
      return `changes:${row.id}:${row.files.map((f) => `${f.path}:${f.added}:${f.removed}`).join('|')}`
    case 'approval':
      return `approval:${row.id}:${row.approval.requestId}`
    default: {
      const _exhaustive: never = row
      return _exhaustive
    }
  }
}

/**
 * Reuse previous TranscriptRow object references when fingerprints match so
 * React.memo(TranscriptRowBlock) can skip historical rows during streaming.
 */
export function stabilizeTranscriptRows(
  previous: readonly TranscriptRow[] | null | undefined,
  next: TranscriptRow[]
): TranscriptRow[] {
  if (!previous?.length) return next
  const prevById = new Map(previous.map((row) => [row.id, row]))
  let changed = previous.length !== next.length
  const out = next.map((row, index) => {
    const prior = prevById.get(row.id) ?? previous[index]
    if (prior && prior.kind === row.kind && transcriptRowFingerprint(prior) === transcriptRowFingerprint(row)) {
      return prior
    }
    changed = true
    return row
  })
  return changed ? out : (previous as TranscriptRow[])
}

/** Tools that write files, and so contribute to a turn's change summary. */
const WRITING_TOOLS = new Set(['edit', 'multi_edit', 'delete'])

function writingToolChanges(item: ToolItem): ChangedFile[] {
  if (!WRITING_TOOLS.has(item.tool.name) || item.tool.status !== 'done') return []
  if (item.tool.name === 'delete') {
    const { path } = parseDeleteData(item.tool)
    if (!path) return []
    return [{ path, added: 0, removed: 1 }]
  }
  return collectWritingChanges(item.tool)
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
    // A single edit already has its own card; only roll up multi-file turns.
    if (turnIndex != null && totals.size >= 2) {
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

/**
 * Fold duplicate prominent cards that represent the same surface in one turn.
 * - todo_write: keep only the latest checklist snapshot for the turn.
 */
function coalesceProminentCards(rows: TranscriptRow[]): TranscriptRow[] {
  const lastTodoByTurn = new Map<number, string>()
  for (const row of rows) {
    if (row.kind === 'card' && row.item.tool.name === 'todo_write') {
      lastTodoByTurn.set(row.turnIndex, row.item.id)
    }
  }

  const out: TranscriptRow[] = []
  for (const row of rows) {
    if (row.kind === 'card' && row.item.tool.name === 'todo_write') {
      if (lastTodoByTurn.get(row.turnIndex) !== row.item.id) continue
    }
    out.push(row)
  }
  return out
}

/**
 * Index where the closing answer begins: a trailing run of text rows only.
 * Mid-turn narration followed by tools is not closing, so it stays out of this suffix.
 */
function closingAnswerStart(turnRows: TranscriptRow[]): number {
  let index = turnRows.length
  while (index > 0 && turnRows[index - 1]!.kind === 'text') {
    index -= 1
  }
  return index
}

/** Only trailing answer text earns a footer; earlier narration stays mid-turn work. */
function markFinalText(rows: TranscriptRow[]): TranscriptRow[] {
  const rowsByTurn = new Map<number, TranscriptRow[]>()
  for (const row of rows) {
    if (row.kind === 'user') continue
    const list = rowsByTurn.get(row.turnIndex) ?? []
    list.push(row)
    rowsByTurn.set(row.turnIndex, list)
  }
  if (rowsByTurn.size === 0) return rows

  const finalTextIds = new Set<string>()
  for (const turnRows of rowsByTurn.values()) {
    const start = closingAnswerStart(turnRows)
    const closing = turnRows.slice(start).filter((row) => row.kind === 'text')
    const last = closing[closing.length - 1]
    if (last?.kind === 'text') finalTextIds.add(last.id)
  }

  return rows.map((row) =>
    row.kind === 'text' ? { ...row, final: finalTextIds.has(row.id) } : row
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
    case 'approval':
      return true
    case 'user':
    case 'turn':
    case 'changes':
      return false
    default: {
      const _exhaustive: never = row
      return _exhaustive
    }
  }
}

/**
 * Append a turn summary after the work block, just before the closing answer.
 *
 * The span runs from the prompt to the last thing the turn produced, which is
 * the interval a reader means by "how long did that take" — not the sum of the
 * individual tool durations, which would exclude the model's own thinking.
 */
function withTurnSummaries(
  rows: TranscriptRow[],
  options?: {
    pendingRun?: boolean
    running?: boolean
    hiddenThinkingStreamingTurns?: ReadonlySet<number>
  }
): TranscriptRow[] {
  const pendingRun = options?.pendingRun
  const running = options?.running
  const hiddenThinkingStreamingTurns = options?.hiddenThinkingStreamingTurns
  let maxTurnIndex = -1
  for (const row of rows) {
    if (row.kind === 'user') maxTurnIndex = Math.max(maxTurnIndex, row.turnIndex)
  }

  const out: TranscriptRow[] = []
  let index = 0

  while (index < rows.length) {
    const row = rows[index]!
    if (row.kind !== 'user') {
      out.push(row)
      index += 1
      continue
    }

    const userRow = row
    out.push(userRow)
    index += 1

    const turnIndex = userRow.turnIndex
    const turnRows: TranscriptRow[] = []
    while (index < rows.length && rows[index]!.turnIndex === turnIndex) {
      turnRows.push(rows[index]!)
      index += 1
    }

    const isLastTurn = turnIndex === maxTurnIndex
    const hasWork = turnRows.some(isTurnWorkRow)
    const isLiveTurn = isLastTurn && (pendingRun === true || running === true)

    const closingStart = closingAnswerStart(turnRows)
    const beforeClosing = turnRows.slice(0, closingStart)
    const closingAnswer = turnRows.slice(closingStart)

    out.push(...beforeClosing)

    if (hasWork || isLiveTurn) {
      const startedAt = toMs(userRow.item.at)
      let endedAt: number | null = null
      for (const entry of turnRows) {
        const { at, endedAt: closed } = rowTimestamps(entry)
        for (const candidate of [at, closed]) {
          if (candidate != null) endedAt = endedAt == null ? candidate : Math.max(endedAt, candidate)
        }
      }

      const rowActive = turnRows.some(isRowActive)
      const active = rowActive || isLiveTurn
      const activity = active
        ? deriveRunActivity(turnRows, isLiveTurn && !rowActive && turnRows.length === 0, {
            hiddenThinkingStreaming: hiddenThinkingStreamingTurns?.has(turnIndex) === true
          })
        : null

      out.push({
        kind: 'turn',
        id: `turn:${userRow.id}`,
        turnIndex,
        span: { startedAt, endedAt, active, activity }
      })
    }

    out.push(...closingAnswer)
  }

  return out
}

/** Leading space a row reserves for turn separation. */
export function rowLeadingGap(row: TranscriptRow): number {
  return row.kind === 'user' && row.turnIndex > 0 ? TURN_GAP_PX : 0
}

/**
 * Stable merge key from tool counts — ignore running vs done tense so a card
 * sandwiched between two identical lookup batches can fold into one header.
 */
function activityGroupKey(tools: ToolItem[]): string {
  const props = mapToolGroupProps(
    tools.map((item) => item.tool),
    {}
  )
  return props.summary || props.runningLabel
}

function isShallowWorkSeparator(row: TranscriptRow): boolean {
  if (row.kind === 'thinking') {
    const text = row.item.thinking?.trim() ?? ''
    if (!text) return true
    return text.length < MIN_VISIBLE_FINISHED_THINKING_CHARS
  }
  if (row.kind === 'text') {
    return !row.item.content?.trim()
  }
  return false
}

function coalesceTurnWork(rows: TranscriptRow[]): TranscriptRow[] {
  const out: TranscriptRow[] = []
  let index = 0

  while (index < rows.length) {
    const row = rows[index]!
    if (row.kind !== 'activity') {
      out.push(row)
      index += 1
      continue
    }

    const turnIndex = row.turnIndex
    const groupKey = activityGroupKey(row.tools)
    let mergedTools = [...row.tools]
    const anchorId = row.id
    const sandwichedCards: TranscriptRow[] = []
    index += 1

    while (index < rows.length && rows[index]!.turnIndex === turnIndex) {
      while (
        index < rows.length &&
        rows[index]!.turnIndex === turnIndex &&
        isShallowWorkSeparator(rows[index]!)
      ) {
        index += 1
      }
      if (index >= rows.length || rows[index]!.turnIndex !== turnIndex) break

      const next = rows[index]!
      if (next.kind === 'card') {
        sandwichedCards.push(next)
        index += 1
        continue
      }
      if (next.kind === 'activity' && activityGroupKey(next.tools) === groupKey) {
        mergedTools.push(...next.tools)
        index += 1
        continue
      }
      break
    }

    out.push({
      kind: 'activity',
      id: anchorId,
      tools: mergedTools,
      turnIndex
    })
    for (const card of sandwichedCards) out.push(card)
  }

  return out
}
