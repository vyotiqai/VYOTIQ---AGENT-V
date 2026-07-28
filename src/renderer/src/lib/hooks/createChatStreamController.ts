import type {
  AgentEvent,
  AttachedFile,
  ChatMessage,
  IncompleteReason,
  PersistedEvent,
  ToolApprovalDecision,
  ToolApprovalRequest
} from '@shared/ipc'
import {
  emptyStepUsageTotals,
  mergeStepUsageTotals,
  stepUsageFromEvent,
  type StepUsageTotals
} from '@shared/utils/runTelemetry'
import { buildUserContent, contentDisplayText, contentImages } from '@shared/ipc'
import {
  appendAssistantWithTools,
  appendToolResult,
  messagesForNextTurn
} from '@shared/chatHistory'
import { isAgentEvent } from '@shared/eventUtils'
import { toLogErr } from '@shared/errors'
import { logger } from '@shared/logger'
import {
  messagesToUiItems,
  applyEventTimestamps,
  finalizeHydratedTranscript,
  mergeThinking,
  messageUiId,
  isToolShapedTextLeak,
  scrubStreamingAssistantToolLeak,
  stripToolShapedAssistantText,
  stripToolShapedAssistantTextForStream,
  uiAttachments,
  MAX_SUBAGENT_PROGRESS_ENTRIES,
  type UiItem,
  type UiToolRow
} from '@shared/transcript'
import { summarizeToolArgs } from '@shared/toolSummary'
import { toolPresentation } from '@renderer/features/chat/toolUi/meta'
import type { ContextUsageState } from '@shared/utils/contextUsage'
import {
  contextUsageFromEvent,
  subagentContextUsageFromEvent,
  summarizeContextUsageFromEvents
} from '@shared/utils/contextUsage'

/** A sub-agent's progress is a live view, not a log; keep the recent tail. */
const CANCEL_RECOVERY_POLL_MS = 500
const CANCEL_RECOVERY_TIMEOUT_MS = 5_000

function withPresentationLock(tool: UiToolRow, name: string, argsPreview?: string): UiToolRow {
  if (tool.presentation) return tool
  return { ...tool, presentation: toolPresentation(name, argsPreview) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Prefer event.code from main; fall back for older events without a code. */
function agentErrorCode(event: Extract<AgentEvent, { type: 'error' }>): string {
  if (event.code) return event.code
  return 'AGENT_LOOP'
}

function trailingToolGroupStart(items: UiItem[]): number {
  if (!items.length || items[items.length - 1].kind !== 'tool') return -1
  let start = items.length - 1
  while (start > 0 && items[start - 1].kind === 'tool') start--
  return start
}

function toolStretchEnd(items: UiItem[], start: number): number {
  let end = start
  while (end < items.length && items[end].kind === 'tool') end++
  return end
}

function trailingLiveToolGroupStart(items: UiItem[]): number {
  const start = trailingToolGroupStart(items)
  if (start < 0) return -1
  const first = items[start]
  if (first.kind !== 'tool' || first.groupTiming?.endedAt) return -1
  return start
}

/**
 * Only insert preamble text before live tools when tools arrived before any
 * assistant text in the same turn. If a finalized assistant precedes live tools,
 * new text belongs to the next turn and must stay after those tools.
 */
function shouldInsertTextBeforeLiveTools(items: UiItem[]): boolean {
  const liveStart = trailingLiveToolGroupStart(items)
  if (liveStart < 0) return false

  for (let i = liveStart - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'message' && item.role === 'assistant') {
      return item.streaming === true
    }
    if (item.kind === 'message' && item.role === 'user') {
      return true
    }
    if (item.kind === 'tool') {
      return false
    }
  }
  return true
}

function insertAssistantItem(items: UiItem[], next: Extract<UiItem, { kind: 'message' }>): UiItem[] {
  if (shouldInsertTextBeforeLiveTools(items)) {
    return insertBeforeTrailingTools(items, next)
  }
  const liveStart = trailingLiveToolGroupStart(items)
  if (liveStart >= 0) {
    const end = toolStretchEnd(items, liveStart)
    return [...items.slice(0, end), next, ...items.slice(end)]
  }
  return prependClosed(items, next)
}

function closeOpenGroupTimings(items: UiItem[], endedAt = Date.now()): UiItem[] {
  const start = trailingLiveToolGroupStart(items)
  if (start < 0) return items
  const first = items[start]
  if (first.kind !== 'tool') return items
  return items.map((item, i) => {
    if (i !== start || item.kind !== 'tool') return item
    return {
      ...item,
      groupTiming: {
        startedAt: item.groupTiming?.startedAt ?? endedAt,
        endedAt
      }
    }
  })
}

function prependClosed(items: UiItem[], next: UiItem | UiItem[]): UiItem[] {
  const closed = closeOpenGroupTimings(items)
  return Array.isArray(next) ? [...closed, ...next] : [...closed, next]
}

/**
 * Place same-turn preamble text before tools that arrived first and are still live.
 * Completed tool stretches stay chronological — next iteration text appends after them.
 */
function insertBeforeTrailingTools(items: UiItem[], next: UiItem | UiItem[]): UiItem[] {
  const batch = Array.isArray(next) ? next : [next]
  const liveStart = trailingLiveToolGroupStart(items)
  if (liveStart >= 0) {
    return [...items.slice(0, liveStart), ...batch, ...items.slice(liveStart)]
  }
  return [...closeOpenGroupTimings(items), ...batch]
}

function toolInsertIndex(items: UiItem[]): number {
  let lastAssistant = -1
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'message' && item.role === 'assistant') {
      lastAssistant = i
      break
    }
  }
  if (lastAssistant < 0) return items.length
  let insertAt = lastAssistant + 1
  while (insertAt < items.length && items[insertAt].kind === 'tool') insertAt++
  return insertAt
}

function appendTool(
  prev: UiItem[],
  toolItem: Extract<UiItem, { kind: 'tool' }>,
  runStartedAt?: number | null
): UiItem[] {
  const insertAt = toolInsertIndex(prev)
  const before = insertAt > 0 ? prev[insertAt - 1] : undefined
  const prevGroupClosed =
    before?.kind === 'tool' && before.groupTiming?.endedAt != null
  const isNewGroup = !before || before.kind !== 'tool' || prevGroupClosed
  const firstToolInRun = !prev.some((item) => item.kind === 'tool')
  const startedAt =
    isNewGroup && firstToolInRun && runStartedAt != null ? runStartedAt : Date.now()

  const row: Extract<UiItem, { kind: 'tool' }> = isNewGroup
    ? { ...toolItem, groupTiming: { startedAt } }
    : toolItem

  return [...prev.slice(0, insertAt), row, ...prev.slice(insertAt)]
}

function ensureToolRowsForCalls(
  items: UiItem[],
  toolCalls: Array<{ id: string; name: string; arguments: string }> | undefined,
  runStartedAt?: number | null
): UiItem[] {
  if (!toolCalls?.length) return items
  let next = items
  for (const tc of toolCalls) {
    const summary = summarizeToolArgs(tc.name, tc.arguments)
    const existingIdx = findToolRowIndex(next, tc.id, tc.name)
    if (existingIdx >= 0) {
      const existing = next[existingIdx]
    if (existing?.kind === 'tool') {
      if (existing.tool.status !== 'running') continue
      next = next.map((item, i) =>
          i === existingIdx && item.kind === 'tool'
            ? withCanonicalToolId(
                {
                  ...item,
                  tool: {
                    ...item.tool,
                    name: tc.name,
                    summary: summary || item.tool.summary,
                    status: 'running' as const,
                    argsPreview: tc.arguments
                  }
                },
                tc.id
              )
            : item
        )
      }
      continue
    }
    if (next.some((i) => i.kind === 'tool' && (i.id === tc.id || i.tool.id === tc.id))) continue
    next = appendTool(
      next,
      {
        kind: 'tool',
        id: tc.id,
        tool: {
          id: tc.id,
          name: tc.name,
          summary,
          status: 'running',
          argsPreview: tc.arguments
        }
      },
      runStartedAt
    )
  }
  return next
}

/**
 * Drop streaming tool rows that never made it into this step's canonical
 * `toolCalls`. Otherwise a cancelled/malformed edit delta stays `running`
 * forever above later completed work.
 */
function pruneOrphanDeltaToolRows(
  items: UiItem[],
  toolCalls: Array<{ id: string }> | undefined
): UiItem[] {
  const keep = new Set((toolCalls ?? []).map((tc) => tc.id))
  let changed = false
  const next = items.filter((item) => {
    if (item.kind !== 'tool' || item.tool.status !== 'running') return true
    if (keep.has(item.id) || keep.has(item.tool.id)) return true

    const pending = isPendingToolId(item.id) || isPendingToolId(item.tool.id)
    if (pending) {
      changed = true
      return false
    }

    // Real id from a delta that the final assistant_message dropped.
    if (toolCalls && toolCalls.length > 0) {
      changed = true
      return false
    }
    return true
  })
  return changed ? next : items
}

/** Close a live trailing tool stretch once every tool in it has finished. */
function closeTrailingGroupIfIdle(items: UiItem[], endedAt = Date.now()): UiItem[] {
  const start = trailingLiveToolGroupStart(items)
  if (start < 0) return items
  for (let i = start; i < items.length; i++) {
    const item = items[i]
    if (item.kind !== 'tool') break
    if (item.tool.status === 'running') return items
  }
  return closeOpenGroupTimings(items, endedAt)
}

function isPendingToolId(id: string): boolean {
  return id.startsWith('pending_')
}

function parsePendingIndex(toolCallId: string): number | null {
  if (!isPendingToolId(toolCallId)) return null
  const n = Number.parseInt(toolCallId.slice('pending_'.length), 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function pendingRunningToolIndices(items: UiItem[]): number[] {
  const out: number[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind !== 'tool') continue
    if (!isPendingToolId(item.id)) continue
    if (item.tool.status !== 'running') continue
    out.push(i)
  }
  return out
}

function findToolRowIndex(items: UiItem[], toolCallId: string, toolName?: string): number {
  const direct = items.findIndex(
    (i) => i.kind === 'tool' && (i.id === toolCallId || i.tool.id === toolCallId)
  )
  if (direct >= 0) return direct

  const pendingIndex = parsePendingIndex(toolCallId)
  if (pendingIndex !== null) {
    const pending = pendingRunningToolIndices(items)
    if (pendingIndex < pending.length) return pending[pendingIndex]
    return -1
  }

  const pending = pendingRunningToolIndices(items)
  for (const idx of pending) {
    const item = items[idx]
    if (item.kind !== 'tool') continue
    if (!isPendingToolId(item.tool.id)) continue
    if (toolName && item.tool.name !== 'tool' && item.tool.name !== toolName) continue
    return idx
  }
  return -1
}

/**
 * Adopt the provider's id on both the row and its tool. Leaving `item.id` as the
 * placeholder would keep the row in the pending pool, so a later unmatched result
 * could claim a row that has already been reconciled.
 */
function withCanonicalToolId(
  item: Extract<UiItem, { kind: 'tool' }>,
  toolCallId: string
): Extract<UiItem, { kind: 'tool' }> {
  if (item.id === toolCallId && item.tool.id === toolCallId) return item
  return {
    ...item,
    id: toolCallId,
    tool: { ...item.tool, id: toolCallId }
  }
}

/**
 * Streaming deltas hit one known row per frame. Copying the array and swapping
 * that index keeps every other row's object identity, so memoized rows skip
 * re-rendering, and avoids running a closure over the whole transcript.
 */
function replaceAt(items: UiItem[], index: number, next: UiItem): UiItem[] {
  const copy = items.slice()
  copy[index] = next
  return copy
}

/** Drop pending approval prompts, either one answered or all of them. */
function clearApprovals(items: UiItem[], requestId?: string): UiItem[] {
  let changed = false
  const next = items.map((item) => {
    if (item.kind !== 'tool' || !item.approval) return item
    if (requestId && item.approval.requestId !== requestId) return item
    changed = true
    const { approval: _approval, ...rest } = item
    return rest
  })
  return changed ? next : items
}

/** Search from the tail: the row a delta targets is almost always the last one. */
function findMessageIndex(items: UiItem[], id: string): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'message' && item.id === id) return i
  }
  return -1
}

function runningToolIndices(items: UiItem[]): number[] {
  const out: number[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'tool' && item.tool.status === 'running') out.push(i)
  }
  return out
}

/**
 * Find the row a `tool_result` belongs to. Beyond the id match, a result whose id
 * drifted from its `tool_start` must still land on the live row: appending a second row
 * would leave the original running forever, which is what pins the group on "Exploring".
 */
function findToolResultRowIndex(items: UiItem[], toolCallId: string, name: string): number {
  const direct = findToolRowIndex(items, toolCallId, name)
  if (direct >= 0) return direct

  const running = runningToolIndices(items)
  for (const idx of running) {
    const item = items[idx]
    if (item.kind === 'tool' && item.tool.name === name) return idx
  }
  // Only adopt an unrelated row when there is no ambiguity about which one is live.
  if (running.length === 1) return running[0]
  return -1
}

function errorFromPersisted(events: PersistedEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]?.event
    if (!isAgentEvent(event)) continue
    if (event.type === 'error') return event.message
  }
  return null
}

function incompleteFromPersisted(events: PersistedEvent[]): IncompleteTurnState | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]?.event
    if (!isAgentEvent(event)) continue
    if (event.type === 'incomplete') {
      return { reason: event.reason, message: event.message }
    }
  }
  return null
}

function hydrateFromDisk(kept: ChatMessage[], events: PersistedEvent[]) {
  const items = applyEventTimestamps(messagesToUiItems(kept), events)
  return {
    messages: kept,
    error: errorFromPersisted(events),
    incomplete: incompleteFromPersisted(events),
    contextUsage: summarizeContextUsageFromEvents(events),
    items: finalizeHydratedTranscript(items, events)
  }
}

/** A turn that ended before the work was finished, offering a Continue affordance. */
export type IncompleteTurnState = {
  reason: IncompleteReason
  message: string
}

export type ChatStreamState = {
  items: UiItem[]
  messages: ChatMessage[]
  running: boolean
  runId: string | null
  error: string | null
  runNotice: string | null
  /** Survives the terminal status event, unlike `runNotice`. */
  incomplete: IncompleteTurnState | null
  contextUsage: ContextUsageState | null
  runStartedAt: number | null
  runTerminalTick: number
  pendingRun: boolean
  transcriptLoading: boolean
  /** Turn summary disclosure — survives transcript remounts like tool/group expand state. */
  collapsedTurnIndices: number[]
}

export type ChatStreamController = ChatStreamState & {
  workspacePath: string
  send: (text: string, images?: string[], files?: AttachedFile[]) => Promise<boolean>
  stop: () => Promise<void>
  reset: () => void
  loadTranscript: (loaded: ChatMessage[], events?: PersistedEvent[]) => void
  /** Load messages without canceling an active/background run (restore / tab select). */
  hydrateTranscript: (loaded: ChatMessage[], events?: PersistedEvent[]) => void
  reattachActiveRun: (runId: string) => Promise<void>
  clearError: () => void
  /** Lazy-load full tool output from disk when IPC preview was truncated. */
  loadToolContent: (toolCallId: string) => Promise<string | null>
  /** Persist thinking block expand/collapse across transcript remounts. */
  setThinkingExpanded: (messageId: string, expanded: boolean) => void
  /** Persist tool detail expand/collapse across transcript remounts. */
  setToolExpanded: (toolCallId: string, expanded: boolean) => void
  /** Persist an activity group's disclosure state, keyed by its first tool row. */
  setGroupExpanded: (anchorToolCallId: string, expanded: boolean) => void
  /** Persist turn summary collapse across transcript remounts. */
  toggleTurnCollapsed: (turnIndex: number) => void
  /** Park a gated tool call on its transcript row until the reader answers. */
  handleApprovalRequest: (request: ToolApprovalRequest) => void
  respondToApproval: (requestId: string, decision: ToolApprovalDecision) => Promise<void>
  /** Reload transcript from disk when a run finished but IPC was missed. */
  syncFromDisk: (runId: string) => Promise<boolean>
  handleEvent: (event: AgentEvent) => void
  subscribe: (listener: () => void) => () => void
  getRevision: () => number
  setTranscriptLoading: (loading: boolean) => void
  /** True after `dispose()`; async restores must not hydrate this instance. */
  readonly disposed: boolean
  dispose: () => void
}

export type CreateChatStreamControllerOptions = {
  workspacePath: string
  runId?: string | null
  onRunIdAssigned?: (runId: string) => void
  onTerminal?: () => void
}

export function createChatStreamController(
  options: CreateChatStreamControllerOptions
): ChatStreamController {
  const { workspacePath, onRunIdAssigned, onTerminal } = options
  const listeners = new Set<() => void>()
  const closedRuns = new Set<string>()
  let assistantId: string | null = null
  /** Row that owns the current step's reasoning, cleared when the step closes. */
  let reasoningId: string | null = null
  /** Next reasoning delta opens a new step, so it needs a break from the previous one. */
  let reasoningSegmentBreak = false
  let runId: string | null = options.runId ?? null
  /** Run id used for lazy tool-result loads after the active session id is cleared. */
  let contentRunId: string | null = options.runId ?? null
  let awaitingRun = false
  let pendingCancel = false
  let ignoreStreamEvents = false
  // A run is reused across turns, so runId alone cannot separate the live turn from a
  // prior one still draining. Events carry the invoke that produced them.
  let activeInvokeId: number | null = null
  const supersededInvokeIds = new Set<number>()
  let disposed = false
  let revision = 0
  let turnSeq = 0
  let completedTurnSeq = 0
  let runningTurnSeq = 0
  let lastRunErrorMessage: string | null = null
  let usageTotals: StepUsageTotals = emptyStepUsageTotals()
  let streamPatchRaf: number | null = null
  let pendingTextDelta = ''
  let pendingThinkingDelta = ''
  const toolContentCache = new Map<string, string>()

  const applyToolCallDelta = (
    items: UiItem[],
    event: { toolCallId: string; name?: string; argumentsDelta: string },
    runStartedAt: number | null
  ): UiItem[] => {
    const existingIdx = findToolRowIndex(items, event.toolCallId, event.name)
    const existing =
      existingIdx >= 0 && items[existingIdx].kind === 'tool' ? items[existingIdx] : undefined
    const toolName = event.name || (existing?.kind === 'tool' ? existing.tool.name : '')
    const argsPreview =
      (existing?.kind === 'tool' ? existing.tool.argsPreview ?? '' : '') + event.argumentsDelta
    const summarized = summarizeToolArgs(toolName || 'tool', argsPreview)
    if (existing?.kind === 'tool') {
      return replaceAt(
        items,
        existingIdx,
        withCanonicalToolId(
          {
            ...existing,
            tool: withPresentationLock(
              {
                ...existing.tool,
                name: toolName || existing.tool.name,
                argsPreview,
                summary: summarized || existing.tool.summary || ''
              },
              toolName || existing.tool.name,
              argsPreview
            )
          },
          event.toolCallId
        )
      )
    }
    return appendTool(
      items,
      {
        kind: 'tool' as const,
        id: event.toolCallId,
        tool: withPresentationLock(
          {
            id: event.toolCallId,
            name: toolName || 'tool',
            summary: summarized,
            status: 'running' as const,
            argsPreview: event.argumentsDelta
          },
          toolName || 'tool',
          event.argumentsDelta
        )
      },
      runStartedAt
    )
  }

  /** Close the open reasoning block once answer text or tool calls begin. */
  const closeOpenThinkingStep = (): void => {
    if (!reasoningId) return
    const id = reasoningId
    const index = findMessageIndex(state.items, id)
    if (index < 0) return
    const item = state.items[index]
    if (item?.kind !== 'message' || !item.thinkingStreaming) return
    patch({
      items: replaceAt(state.items, index, {
        ...item,
        thinkingStreaming: false
      })
    })
  }

  const applyToolCallDeltaEvent = (
    event: Extract<AgentEvent, { type: 'tool_call_delta' }>
  ): void => {
    if (isToolShapedTextLeak(pendingTextDelta)) {
      pendingTextDelta = ''
    }
    closeOpenThinkingStep()
    let items = applyToolCallDelta(state.items, event, state.runStartedAt)
    items = scrubStreamingAssistantToolLeak(items)
    patch({ items })
  }

  const applyStreamingPatches = (): void => {
    let items = state.items
    let changed = false

    if (pendingThinkingDelta && reasoningId) {
      const text = pendingThinkingDelta
      pendingThinkingDelta = ''
      const id = reasoningId
      const index = findMessageIndex(items, id)
      if (index < 0) {
        // `thinkingExpanded` stays unset: it records the reader's own choice, and
        // leaving it blank lets the block follow the stream on its own.
        items = insertAssistantItem(items, {
          kind: 'message',
          id,
          role: 'assistant',
          content: '',
          thinking: text,
          thinkingStreaming: true,
          streaming: false
        })
      } else {
        const current = items[index] as Extract<UiItem, { kind: 'message' }>
        const prior = current.thinking ?? ''
        items = replaceAt(items, index, {
          ...current,
          thinking:
            reasoningSegmentBreak && prior.trim() ? `${prior.trimEnd()}\n\n${text}` : prior + text,
          thinkingStreaming: true
        })
      }
      reasoningSegmentBreak = false
      changed = true
    } else {
      pendingThinkingDelta = ''
    }

    if (pendingTextDelta && assistantId) {
      const text = pendingTextDelta
      pendingTextDelta = ''
      const id = assistantId
      const index = findMessageIndex(items, id)
      if (index < 0) {
        items = insertAssistantItem(items, {
          kind: 'message',
          id,
          role: 'assistant',
          content: stripToolShapedAssistantTextForStream(text),
          streaming: true
        })
      } else {
        const current = items[index] as Extract<UiItem, { kind: 'message' }>
        items = replaceAt(items, index, {
          ...current,
          content: stripToolShapedAssistantTextForStream(current.content + text),
          streaming: true
        })
      }
      changed = true
    } else {
      pendingTextDelta = ''
    }

    if (changed) {
      items = scrubStreamingAssistantToolLeak(items)
      patch({ items })
    }
  }

  const flushStreamingPatches = (): void => {
    if (streamPatchRaf != null) {
      cancelAnimationFrame(streamPatchRaf)
      streamPatchRaf = null
    }
    applyStreamingPatches()
  }

  const scheduleStreamingPatch = (): void => {
    if (streamPatchRaf != null) return
    streamPatchRaf = requestAnimationFrame(() => {
      streamPatchRaf = null
      applyStreamingPatches()
    })
  }

  const scheduleTextDelta = (text: string): void => {
    pendingTextDelta += text
    scheduleStreamingPatch()
  }

  const scheduleThinkingDelta = (text: string): void => {
    pendingThinkingDelta += text
    scheduleStreamingPatch()
  }

  const state: ChatStreamState = {
    items: [],
    messages: [],
    running: false,
    runId,
    error: null,
    runNotice: null,
    incomplete: null,
    contextUsage: null,
    runStartedAt: null,
    runTerminalTick: 0,
    pendingRun: false,
    transcriptLoading: false,
    collapsedTurnIndices: []
  }

  const notify = (): void => {
    if (disposed) return
    revision += 1
    for (const listener of listeners) listener()
  }

  const getRevision = (): number => revision

  const patch = (partial: Partial<ChatStreamState>): void => {
    if (disposed) return
    Object.assign(state, partial)
    notify()
  }

  const closeRun = (id: string | null | undefined): void => {
    if (!id) return
    closedRuns.add(id)
  }

  const clearSessionUi = (opts?: { preservePendingCancel?: boolean }): void => {
    assistantId = null
    reasoningId = null
    runId = null
    contentRunId = null
    ignoreStreamEvents = false
    if (activeInvokeId != null) supersededInvokeIds.add(activeInvokeId)
    activeInvokeId = null
    usageTotals = emptyStepUsageTotals()
    toolContentCache.clear()
    if (!opts?.preservePendingCancel) pendingCancel = false
    patch({
      items: [],
      messages: [],
      error: null,
      runNotice: null,
      incomplete: null,
      contextUsage: null,
      runId: null,
      running: false,
      runStartedAt: null,
      pendingRun: false,
      collapsedTurnIndices: []
    })
  }

  const assignRunId = (id: string): void => {
    if (closedRuns.has(id)) return
    const changed = runId !== id
    runId = id
    contentRunId = id
    patch({ runId: id, pendingRun: false })
    if (changed) onRunIdAssigned?.(id)
  }

  /** True for events left over from a turn that a newer send has already replaced. */
  const isSupersededEvent = (event: AgentEvent): boolean => {
    if (event.invokeId == null) return false
    if (supersededInvokeIds.has(event.invokeId)) return true
    return activeInvokeId != null && event.invokeId !== activeInvokeId
  }

  const handleEvent = (event: AgentEvent): void => {
    if (disposed) return
    if (closedRuns.has(event.runId)) return
    if (isSupersededEvent(event)) return

    if (runId) {
      if (event.runId !== runId) return
    } else if (awaitingRun) {
      assignRunId(event.runId)
    } else {
      return
    }

    if (ignoreStreamEvents) return

    if (
      event.type !== 'text_delta' &&
      event.type !== 'thinking_delta'
    ) {
      flushStreamingPatches()
    }

    if (event.type === 'text_delta') {
      if (!assistantId) assistantId = messageUiId('assistant', state.messages.length)
      flushStreamingPatches()
      closeOpenThinkingStep()
      scheduleTextDelta(event.text)
      return
    } else if (event.type === 'thinking_delta') {
      if (!assistantId) assistantId = messageUiId('assistant', state.messages.length)
      if (!reasoningId) reasoningId = assistantId
      scheduleThinkingDelta(event.text)
      return
    } else if (event.type === 'thinking_done') {
      flushStreamingPatches()
      reasoningSegmentBreak = true
      const id = reasoningId
      if (!id) return
      const doneAt = new Date().toISOString()
      patch({
        items: state.items.map((item) =>
          item.kind === 'message' && item.id === id
            ? {
                ...item,
                thinking: event.text ? mergeThinking(item.thinking, event.text) : item.thinking,
                thinkingStreaming: false,
                at: item.at ?? doneAt
              }
            : item
        )
      })
      return
    } else if (event.type === 'assistant_message') {
      const id = assistantId ?? messageUiId('assistant', state.messages.length)
      assistantId = null
      reasoningSegmentBreak = true
      const messageAt = new Date().toISOString()
      const content = stripToolShapedAssistantText(event.content)
      // Keep same-turn tool stretches live when this message still has toolCalls.
      // Only close when this is a text-only follow-up (next iteration / final answer).
      const base = event.toolCalls?.length
        ? state.items
        : closeOpenGroupTimings(state.items)
      const exists = base.some((i) => i.kind === 'message' && i.id === id)
      const reasoningTarget =
        event.thinking && reasoningId && reasoningId !== id ? reasoningId : null
      let nextItems = reasoningTarget
        ? base.map((item) =>
            item.kind === 'message' && item.id === reasoningTarget
              ? {
                  ...item,
                  thinking: mergeThinking(item.thinking, event.thinking ?? ''),
                  thinkingStreaming: false
                }
              : item
          )
        : base
      if (exists) {
        nextItems = nextItems.map((item) =>
          item.kind === 'message' && item.id === id
            ? {
                ...item,
                content: content || stripToolShapedAssistantText(item.content),
                thinking: reasoningTarget
                  ? item.thinking
                  : mergeThinking(item.thinking, event.thinking ?? ''),
                thinkingStreaming: false,
                streaming: false,
                at: item.at ?? messageAt
              }
            : item
        )
      } else if (content || (event.thinking && !reasoningTarget)) {
        nextItems = insertAssistantItem(nextItems, {
          kind: 'message',
          id,
          role: 'assistant',
          content,
          thinking: event.thinking,
          thinkingStreaming: false,
          streaming: false,
          at: messageAt
        })
      }
      reasoningId = null
      const nextMessages = appendAssistantWithTools(
        state.messages,
        content,
        event.toolCalls,
        event.thinking
      )
      nextItems = ensureToolRowsForCalls(nextItems, event.toolCalls, state.runStartedAt)
      nextItems = pruneOrphanDeltaToolRows(nextItems, event.toolCalls)
      patch({ items: nextItems, messages: nextMessages })
    } else if (event.type === 'tool_call_delta') {
      applyToolCallDeltaEvent(event)
    } else if (event.type === 'tool_start') {
      assistantId = null
      const items = state.items
      const toolAt = new Date().toISOString()
      const existingIdx = findToolRowIndex(items, event.toolCallId, event.name)
      const existing =
        existingIdx >= 0 && items[existingIdx].kind === 'tool' ? items[existingIdx] : undefined
      if (existing?.kind === 'tool') {
        patch({
          items: items.map((item, i) =>
            i === existingIdx && item.kind === 'tool'
              ? withCanonicalToolId(
                  {
                    ...item,
                    at: item.at ?? toolAt,
                    toolExpanded: event.name === 'subagent' ? true : item.toolExpanded,
                    tool: withPresentationLock(
                      {
                        ...item.tool,
                        name: event.name,
                        summary: event.summary,
                        status: 'running' as const
                      },
                      event.name,
                      item.tool.argsPreview
                    )
                  },
                  event.toolCallId
                )
              : item
          )
        })
      } else {
        patch({
          items: appendTool(
            items,
            {
              kind: 'tool' as const,
              id: event.toolCallId,
              at: toolAt,
              toolExpanded: event.name === 'subagent' ? true : undefined,
              tool: withPresentationLock(
                {
                  id: event.toolCallId,
                  name: event.name,
                  summary: event.summary,
                  status: 'running' as const
                },
                event.name
              )
            },
            state.runStartedAt
          )
        })
      }
    } else if (event.type === 'tool_result') {
      const items = state.items
      const existingIdx = findToolResultRowIndex(items, event.toolCallId, event.name)
      const existing =
        existingIdx >= 0 && items[existingIdx].kind === 'tool' ? items[existingIdx] : undefined
      let nextItems = items
      if (existing?.kind === 'tool') {
        nextItems = items.map((item, i) =>
          i === existingIdx && item.kind === 'tool'
            ? withCanonicalToolId(
                {
                  ...item,
                  // The call is settled, so any prompt it was waiting on is moot.
                  approval: undefined,
                  tool: {
                    ...item.tool,
                    name: event.name,
                    summary: event.summary,
                    status: event.ok ? 'done' : 'fail',
                    content: event.content ?? item.tool.content,
                    contentTruncated: event.contentTruncated ?? item.tool.contentTruncated
                  }
                },
                event.toolCallId
              )
            : item
        )
      } else {
        nextItems = appendTool(
          items,
          {
            kind: 'tool' as const,
            id: event.toolCallId,
            tool: {
              id: event.toolCallId,
              name: event.name,
              summary: event.summary,
              status: event.ok ? 'done' : 'fail',
              content: event.content,
              contentTruncated: event.contentTruncated
            }
          },
          state.runStartedAt
        )
      }
      const nextMessages = appendToolResult(
        state.messages,
        event.toolCallId,
        event.name,
        event.content ?? event.summary,
        event.ok
      )
      patch({
        items: closeTrailingGroupIfIdle(nextItems),
        messages: nextMessages
      })
    } else if (event.type === 'subagent_update') {
      const idx = findToolRowIndex(state.items, event.parentToolCallId)
      const item = idx >= 0 ? state.items[idx] : undefined
      if (!item || item.kind !== 'tool') return
      const entries = [...(item.subagent ?? []), { kind: event.kind, text: event.text }].slice(
        -MAX_SUBAGENT_PROGRESS_ENTRIES
      )
      patch({
        items: replaceAt(state.items, idx, {
          ...item,
          subagent: entries,
          toolExpanded: true
        })
      })
    } else if (event.type === 'subagent_context_usage') {
      const idx = findToolRowIndex(state.items, event.parentToolCallId)
      const item = idx >= 0 ? state.items[idx] : undefined
      if (!item || item.kind !== 'tool') return
      const usage = subagentContextUsageFromEvent(event)
      if (!usage) return
      patch({
        items: replaceAt(state.items, idx, {
          ...item,
          subagentContextUsage: usage
        })
      })
    } else if (event.type === 'error') {
      lastRunErrorMessage = event.message
      logger.warn('Agent run error', {
        scope: 'chat',
        correlationId: event.runId,
        code: agentErrorCode(event),
        err: toLogErr(event.message)
      })
      patch({
        error: event.message
      })
    } else if (event.type === 'stream_reset') {
      // Drop the aborted attempt's output so the retry does not append to it —
      // text, thinking, and any tool rows that only exist from streamed deltas.
      pendingTextDelta = ''
      pendingThinkingDelta = ''
      flushStreamingPatches()
      const discardIds = new Set([assistantId, reasoningId].filter((id): id is string => !!id))
      const nextItems = state.items
        .filter(
          (item) =>
            !(item.kind === 'tool' && item.tool.status === 'running' && !item.approval)
        )
        .map((item) =>
          item.kind === 'message' && discardIds.has(item.id)
            ? {
                ...item,
                content: '',
                thinking: item.thinking ? '' : item.thinking,
                streaming: false,
                thinkingStreaming: false
              }
            : item
        )
      patch({ items: nextItems })
    } else if (event.type === 'incomplete') {
      patch({
        incomplete: { reason: event.reason, message: event.message }
      })
    } else if (event.type === 'compaction') {
      patch({
        runNotice: 'Context summarized to stay within the model window.'
      })
    } else if (event.type === 'step_usage') {
      const usage = stepUsageFromEvent(event)
      if (usage) {
        usageTotals = mergeStepUsageTotals(usageTotals, usage)
        if (state.contextUsage) {
          patch({
            contextUsage: {
              ...state.contextUsage,
              stepUsage: usageTotals,
              updatedAt: new Date().toISOString()
            }
          })
        }
      }
    } else if (event.type === 'context_usage') {
      const ctx = contextUsageFromEvent(event, usageTotals)
      if (ctx) patch({ contextUsage: ctx })
    } else if (event.type === 'status') {
      if (event.status === 'running') {
        runningTurnSeq = turnSeq
        patch({
          running: true,
          pendingRun: false,
          runStartedAt: state.runStartedAt ?? Date.now()
        })
      }
      if (event.status === 'done' || event.status === 'cancelled' || event.status === 'error') {
        // When the event carries an invoke we started, attribution is exact and any
        // stale terminal was already dropped. Otherwise — a reattached run, or a
        // replay with no stamp — fall back to the turn sequence.
        const attributed = event.invokeId != null && event.invokeId === activeInvokeId
        if (!attributed) {
          if (turnSeq > 0 && completedTurnSeq >= turnSeq) return
          if (
            completedTurnSeq > 0 &&
            turnSeq > completedTurnSeq &&
            state.running &&
            turnSeq > runningTurnSeq
          ) {
            return
          }
        }

        awaitingRun = false
        pendingCancel = false
        assistantId = null
        reasoningId = null
        ignoreStreamEvents = true
        completedTurnSeq = turnSeq
        const sessionRunId = runId ?? event.runId
        runId = sessionRunId
        patch({
          pendingRun: false,
          running: false,
          runId: sessionRunId,
          runStartedAt: null,
          runNotice: null,
          runTerminalTick: state.runTerminalTick + 1,
          ...(event.status === 'error' && !state.error
            ? { error: lastRunErrorMessage ?? 'Run failed' }
            : {}),
          items: clearApprovals(closeOpenGroupTimings(state.items)).map((item) => {
            if (item.kind === 'message' && (item.streaming || item.thinkingStreaming)) {
              return { ...item, streaming: false, thinkingStreaming: false }
            }
            if (item.kind === 'tool' && item.tool.status === 'running') {
              const interrupted =
                event.status === 'cancelled'
                  ? 'Cancelled'
                  : event.status === 'error'
                    ? 'Interrupted'
                    : 'Stopped'
              return {
                ...item,
                tool: {
                  ...item.tool,
                  status: 'fail' as const,
                  content: item.tool.content ?? interrupted
                }
              }
            }
            return item
          })
        })
        onTerminal?.()
      }
    }
  }

  const send = async (
    text: string,
    images?: string[],
    files?: AttachedFile[]
  ): Promise<boolean> => {
    const trimmed = text.trim()
    if ((!trimmed && !images?.length && !files?.length) || state.running || state.transcriptLoading)
      return false
    if (!workspacePath) {
      patch({ error: 'Pick a workspace before starting a chat.' })
      return false
    }
    patch({ error: null, runNotice: null, incomplete: null })
    lastRunErrorMessage = null
    usageTotals = emptyStepUsageTotals()
    // Keep last contextUsage so the meter does not flicker away between turns;
    // stepUsage resets via usageTotals and is overwritten on the next event.
    pendingCancel = false
    ignoreStreamEvents = false
    // Anything still arriving from the turn we are replacing is now stale, including a
    // terminal status that would otherwise close out this new turn.
    if (activeInvokeId != null) supersededInvokeIds.add(activeInvokeId)
    activeInvokeId = null
    turnSeq += 1
    const content = buildUserContent(text, images, files)
    const user: ChatMessage = { role: 'user', content }
    const priorMessages = state.messages
    const nextMessages = messagesForNextTurn([...priorMessages, user])
    const userItemId = messageUiId('user', nextMessages.length - 1)
    const imageUrls = contentImages(content)
    const attachments = uiAttachments(content)
    const displayText = contentDisplayText(content)
    const sentAt = new Date().toISOString()
    patch({
      messages: nextMessages,
      items: prependClosed(state.items, {
        kind: 'message',
        id: userItemId,
        role: 'user',
        content: displayText,
        images: imageUrls.length ? imageUrls : undefined,
        attachments: attachments.length ? attachments : undefined,
        at: sentAt
      })
    })
    assistantId = null
    reasoningId = null
    const continuingRunId = runId
    if (continuingRunId) {
      awaitingRun = false
      patch({
        pendingRun: true,
        running: true,
        runStartedAt: Date.now(),
        runId: continuingRunId
      })
    } else {
      closeRun(runId)
      runId = null
      awaitingRun = true
      patch({ pendingRun: true, running: true, runStartedAt: Date.now(), runId: null })
    }
    const res = await window.vyotiq.chatStart(
      continuingRunId
        ? {
            incremental: true,
            newMessages: [user],
            workspacePath,
            runId: continuingRunId
          }
        : {
            messages: nextMessages,
            workspacePath
          }
    )
    if (!res.ok) {
      awaitingRun = false
      logger.error('chatStart failed', { scope: 'chat', err: toLogErr(res.error) })
      patch({
        error: res.error,
        running: false,
        runStartedAt: null,
        pendingRun: false,
        runId: null,
        messages: priorMessages,
        items: state.items.filter((item) => item.id !== userItemId)
      })
      return false
    }
    if (pendingCancel) {
      pendingCancel = false
      awaitingRun = false
      supersededInvokeIds.add(res.data.invokeId)
      closeRun(res.data.runId)
      runId = null
      patch({ pendingRun: false, running: false, runStartedAt: null, runId: null })
      const cancelRes = await window.vyotiq.chatCancel(res.data.runId)
      if (!cancelRes.ok) {
        logger.warn('chatCancel failed after pending stop', {
          scope: 'chat',
          correlationId: res.data.runId,
          err: cancelRes.error
        })
      }
      return true
    }
    if (!closedRuns.has(res.data.runId)) {
      assignRunId(res.data.runId)
    }
    activeInvokeId = res.data.invokeId
    supersededInvokeIds.delete(res.data.invokeId)
    awaitingRun = false
    return true
  }

  const syncFromDisk = async (id: string): Promise<boolean> => {
    if (!window.vyotiq?.loadRun) return false
    const res = await window.vyotiq.loadRun(workspacePath, id)
    if (!res.ok) {
      logger.warn('syncFromDisk loadRun failed', {
        scope: 'chat',
        correlationId: id,
        err: toLogErr(res.error)
      })
      return false
    }
    let events: PersistedEvent[] = []
    if (window.vyotiq.loadRunEvents) {
      const eventsRes = await window.vyotiq.loadRunEvents(workspacePath, id)
      if (eventsRes.ok) events = eventsRes.data
    }
    const kept = messagesForNextTurn(res.data.messages)
    assistantId = null
    reasoningId = null
    runId = null
    contentRunId = id
    awaitingRun = false
    pendingCancel = false
    patch({
      ...hydrateFromDisk(kept, events),
      runId: null,
      pendingRun: false,
      running: false,
      runStartedAt: null,
      runTerminalTick: state.runTerminalTick + 1
    })
    onTerminal?.()
    return true
  }

  const recoverAfterCancelFailure = async (id: string, cancelError: string): Promise<void> => {
    if (/not found/i.test(cancelError)) {
      const synced = await syncFromDisk(id)
      if (synced) return
    }
    const deadline = Date.now() + CANCEL_RECOVERY_TIMEOUT_MS
    while (Date.now() < deadline) {
      const active = await window.vyotiq.listActiveRuns?.()
      if (active?.ok && !active.data.some((entry) => entry.runId === id)) {
        const synced = await syncFromDisk(id)
        if (synced) return
        break
      }
      await sleep(CANCEL_RECOVERY_POLL_MS)
    }
    patch({ error: cancelError })
  }

  const stop = async (): Promise<void> => {
    const id = runId
    if (!id) {
      pendingCancel = true
      return
    }
    const res = await window.vyotiq.chatCancel(id)
    if (!res.ok) {
      logger.warn('chatCancel failed', {
        scope: 'chat',
        correlationId: id,
        err: toLogErr(res.error)
      })
      await recoverAfterCancelFailure(id, res.error)
    }
  }

  const reset = (): void => {
    const id = runId
    if (id) {
      closeRun(id)
      void window.vyotiq.chatCancel(id).then(async (res) => {
        if (!res.ok) await recoverAfterCancelFailure(id, res.error)
      })
      awaitingRun = false
      clearSessionUi()
      return
    }
    if (awaitingRun) {
      pendingCancel = true
      clearSessionUi({ preservePendingCancel: true })
      return
    }
    clearSessionUi()
    awaitingRun = false
  }

  const applyTranscriptUi = (loaded: ChatMessage[], events?: PersistedEvent[]): void => {
    const kept = messagesForNextTurn(loaded)
    const rows = events ?? []
    assistantId = null
    reasoningId = null
    if (activeInvokeId != null) supersededInvokeIds.add(activeInvokeId)
    activeInvokeId = null
    usageTotals = emptyStepUsageTotals()
    toolContentCache.clear()
    patch(hydrateFromDisk(kept, rows))
  }

  /** Replace session UI and cancel any in-flight run on this controller. */
  const loadTranscript = (loaded: ChatMessage[], events?: PersistedEvent[]): void => {
    const id = runId
    if (id) {
      closeRun(id)
      void window.vyotiq.chatCancel(id).then(async (res) => {
        if (!res.ok) await recoverAfterCancelFailure(id, res.error)
      })
      pendingCancel = false
      awaitingRun = false
    } else if (awaitingRun) {
      pendingCancel = true
      awaitingRun = false
    } else {
      pendingCancel = false
    }
    runId = null
    contentRunId = null
    patch({
      pendingRun: false,
      running: false,
      runId: null,
      runStartedAt: null
    })
    applyTranscriptUi(loaded, events)
  }

  /** Hydrate UI from disk without canceling — used for restore and tab select. */
  const hydrateTranscript = (loaded: ChatMessage[], events?: PersistedEvent[]): void => {
    if (disposed) return
    // Never clobber an in-flight live stream with a lagging disk snapshot.
    if (state.running || state.pendingRun || awaitingRun) return
    applyTranscriptUi(loaded, events)
  }

  const reattachActiveRun = async (id: string): Promise<void> => {
    if (closedRuns.has(id) || disposed) return
    // Poll/mount can race a terminal status — verify the run is still live.
    let liveInvokeId: number | null = null
    if (window.vyotiq?.listActiveRuns) {
      const active = await window.vyotiq.listActiveRuns()
      if (!active.ok || !active.data.some((entry) => entry.runId === id)) {
        await syncFromDisk(id)
        return
      }
      liveInvokeId = active.data.find((entry) => entry.runId === id)?.invokeId ?? null
    }
    if (closedRuns.has(id) || disposed) return
    runId = id
    contentRunId = id
    if (liveInvokeId != null) activeInvokeId = liveInvokeId
    patch({
      runId: id,
      running: true,
      pendingRun: false,
      runStartedAt: state.runStartedAt ?? Date.now(),
      error: null
    })
    if (state.items.length > 0) {
      let events: PersistedEvent[] = []
      if (window.vyotiq?.loadRunEvents) {
        const eventsRes = await window.vyotiq.loadRunEvents(workspacePath, id)
        if (closedRuns.has(id) || disposed) return
        if (eventsRes.ok) events = eventsRes.data
      }
      if (events.length > 0) {
        patch({ items: applyEventTimestamps(state.items, events) })
      }
      return
    }
    if (!window.vyotiq?.loadRun) return
    const res = await window.vyotiq.loadRun(workspacePath, id)
    if (closedRuns.has(id) || disposed) return
    if (!res.ok) {
      logger.warn('reattachActiveRun loadRun failed', {
        scope: 'chat',
        correlationId: id,
        err: toLogErr(res.error)
      })
      return
    }
    let events: PersistedEvent[] = []
    if (window.vyotiq.loadRunEvents) {
      const eventsRes = await window.vyotiq.loadRunEvents(workspacePath, id)
      if (closedRuns.has(id) || disposed) return
      if (eventsRes.ok) events = eventsRes.data
    }
    const kept = messagesForNextTurn(res.data.messages)
    patch(hydrateFromDisk(kept, events))
  }

  const setToolExpanded = (toolCallId: string, expanded: boolean): void => {
    patch({
      items: state.items.map((item) =>
        item.kind === 'tool' && (item.id === toolCallId || item.tool.id === toolCallId)
          ? { ...item, toolExpanded: expanded }
          : item
      )
    })
  }

  const setGroupExpanded = (anchorToolCallId: string, expanded: boolean): void => {
    patch({
      items: state.items.map((item) =>
        item.kind === 'tool' && (item.id === anchorToolCallId || item.tool.id === anchorToolCallId)
          ? { ...item, groupExpanded: expanded }
          : item
      )
    })
  }

  const handleApprovalRequest = (request: ToolApprovalRequest): void => {
    if (closedRuns.has(request.runId)) return
    if (runId && request.runId !== runId) return

    const approval = {
      requestId: request.requestId,
      toolName: request.name,
      summary: request.summary,
      argsPreview: request.argsPreview,
      mutating: request.mutating
    }
    const idx = findToolRowIndex(state.items, request.toolCallId)
    if (idx < 0 || state.items[idx]?.kind !== 'tool') {
      // The row should already exist, but the loop is parked either way: show
      // the prompt on a row of its own rather than stalling with no way out.
      // Insert beside other tools for this turn — not at the transcript tail.
      patch({
        items: appendTool(
          state.items,
          {
            kind: 'tool' as const,
            id: request.toolCallId,
            tool: {
              id: request.toolCallId,
              name: request.name,
              summary: request.summary,
              status: 'running' as const,
              ...(request.argsPreview ? { argsPreview: request.argsPreview } : {})
            },
            approval
          },
          state.runStartedAt
        )
      })
      return
    }
    patch({
      items: replaceAt(state.items, idx, { ...state.items[idx], approval })
    })
  }

  const respondToApproval = async (
    requestId: string,
    decision: ToolApprovalDecision
  ): Promise<void> => {
    const res = await window.vyotiq?.respondToolApproval?.(requestId, decision)
    if (!res) {
      const message = 'Tool approval is unavailable.'
      logger.warn('Tool approval response unavailable', { scope: 'chat' })
      patch({ error: message })
      throw new Error(message)
    }
    if (!res.ok) {
      logger.warn('Tool approval response rejected', {
        scope: 'chat',
        err: toLogErr(res.error)
      })
      patch({ error: res.error })
      throw new Error(res.error)
    }
    // Only clear the card after main accepted the decision — otherwise the run
    // stays parked with no way to answer again.
    patch({ items: clearApprovals(state.items, requestId), error: null })
  }

  const clearError = (): void => {
    patch({ error: null })
  }

  const setThinkingExpanded = (messageId: string, expanded: boolean): void => {
    patch({
      items: state.items.map((item) =>
        item.kind === 'message' && item.id === messageId
          ? { ...item, thinkingExpanded: expanded }
          : item
      )
    })
  }

  const toggleTurnCollapsed = (turnIndex: number): void => {
    const collapsed = new Set(state.collapsedTurnIndices)
    if (!collapsed.delete(turnIndex)) collapsed.add(turnIndex)
    patch({ collapsedTurnIndices: [...collapsed] })
  }

  const patchToolContent = (toolCallId: string, content: string): void => {
    toolContentCache.set(toolCallId, content)
    const items = state.items
    const idx = findToolRowIndex(items, toolCallId)
    if (idx < 0 || items[idx]?.kind !== 'tool') return
    patch({
      items: items.map((item, i) =>
        i === idx && item.kind === 'tool'
          ? {
              ...item,
              tool: {
                ...item.tool,
                content,
                contentTruncated: false
              }
            }
          : item
      )
    })
  }

  const loadToolContent = async (toolCallId: string): Promise<string | null> => {
    const cached = toolContentCache.get(toolCallId)
    if (cached) return cached

    const id = runId ?? contentRunId
    if (!id || !window.vyotiq?.loadToolResult) return null

    const res = await window.vyotiq.loadToolResult(workspacePath, id, toolCallId)
    if (disposed) return null
    if (!res.ok) {
      logger.warn('loadToolResult failed', {
        scope: 'chat',
        correlationId: id,
        toolCallId,
        err: toLogErr(res.error)
      })
      return null
    }
    patchToolContent(toolCallId, res.data.content)
    return res.data.content
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const setTranscriptLoading = (loading: boolean): void => {
    if (disposed) return
    patch({ transcriptLoading: loading })
  }

  const dispose = (): void => {
    disposed = true
    flushStreamingPatches()
    listeners.clear()
  }

  const controller: ChatStreamController = {
    get items() {
      return state.items
    },
    get messages() {
      return state.messages
    },
    get running() {
      return state.running
    },
    get runId() {
      return state.runId
    },
    get error() {
      return state.error
    },
    get runNotice() {
      return state.runNotice
    },
    get incomplete() {
      return state.incomplete
    },
    get contextUsage() {
      return state.contextUsage
    },
    get runStartedAt() {
      return state.runStartedAt
    },
    get runTerminalTick() {
      return state.runTerminalTick
    },
    get pendingRun() {
      return state.pendingRun
    },
    get transcriptLoading() {
      return state.transcriptLoading
    },
    get collapsedTurnIndices() {
      return state.collapsedTurnIndices
    },
    get disposed() {
      return disposed
    },
    workspacePath,
    send,
    stop,
    reset,
    loadTranscript,
    hydrateTranscript,
    reattachActiveRun,
    clearError,
    loadToolContent,
    setThinkingExpanded,
    setToolExpanded,
    setGroupExpanded,
    toggleTurnCollapsed,
    handleApprovalRequest,
    respondToApproval,
    syncFromDisk,
    handleEvent,
    subscribe,
    getRevision,
    setTranscriptLoading,
    dispose
  }

  return controller
}
