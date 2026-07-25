import type { AgentEvent, ChatMessage, PersistedEvent } from '@shared/ipc'
import {
  emptyStepUsageTotals,
  formatCacheHintFromTotals,
  mergeStepUsageTotals,
  stepUsageFromEvent,
  summarizeStepUsageFromEvents,
  type StepUsageTotals
} from '@shared/utils/runTelemetry'
import { buildUserContent, contentDisplayText, contentImages } from '@shared/ipc'
import {
  appendAssistantWithTools,
  appendToolResult,
  messagesForNextTurn
} from '@shared/chatHistory'
import { activityPanelRowsFromEvents, isActivityPanelEvent, isAgentEvent, type ActivityRow } from '@shared/eventUtils'
import { toLogErr } from '@shared/errors'
import { logger } from '@shared/logger'
import { messagesToUiItems, applyEventTimestamps, messageUiId, type UiItem } from '@shared/transcript'
import { summarizeToolArgs } from '@shared/toolSummary'
import type { ContextUsageState } from '@shared/utils/contextUsage'
import {
  contextUsageFromEvent,
  summarizeContextUsageFromEvents
} from '@shared/utils/contextUsage'

const CANCEL_RECOVERY_POLL_MS = 500
const CANCEL_RECOVERY_TIMEOUT_MS = 5_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Prefer event.code from main; fall back for older events without a code. */
function agentErrorCode(event: Extract<AgentEvent, { type: 'error' }>): string {
  if (event.code) return event.code
  if (/^Stopped after \d+ steps/i.test(event.message)) return 'AGENT_MAX_STEPS'
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

function withCanonicalToolId(
  item: Extract<UiItem, { kind: 'tool' }>,
  toolCallId: string
): Extract<UiItem, { kind: 'tool' }> {
  if (item.tool.id === toolCallId) return item
  return {
    ...item,
    tool: { ...item.tool, id: toolCallId }
  }
}

function errorFromPersisted(events: PersistedEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]?.event
    if (!isAgentEvent(event)) continue
    if (event.type === 'error') return event.message
  }
  return null
}

export type ChatStreamState = {
  items: UiItem[]
  messages: ChatMessage[]
  activityRows: ActivityRow[]
  running: boolean
  runId: string | null
  error: string | null
  runNotice: string | null
  runCacheHint: string | null
  contextUsage: ContextUsageState | null
  runStartedAt: number | null
  runTerminalTick: number
  pendingRun: boolean
  transcriptLoading: boolean
}

export type ChatStreamController = ChatStreamState & {
  workspacePath: string
  send: (text: string, images?: string[]) => Promise<boolean>
  stop: () => Promise<void>
  reset: () => void
  loadTranscript: (loaded: ChatMessage[], events?: PersistedEvent[]) => void
  /** Load messages without canceling an active/background run (restore / tab select). */
  hydrateTranscript: (loaded: ChatMessage[], events?: PersistedEvent[]) => void
  reattachActiveRun: (runId: string) => Promise<void>
  clearError: () => void
  /** Lazy-load full tool output from disk when IPC preview was truncated. */
  loadToolContent: (toolCallId: string) => Promise<string | null>
  /** Persist thinking block expand/collapse across virtual list remounts. */
  setThinkingExpanded: (messageId: string, expanded: boolean) => void
  /** Persist tool detail expand/collapse across virtual list remounts. */
  setToolExpanded: (toolCallId: string, expanded: boolean) => void
  /** Reload transcript from disk when a run finished but IPC was missed. */
  syncFromDisk: (runId: string) => Promise<boolean>
  handleEvent: (event: AgentEvent) => void
  subscribe: (listener: () => void) => () => void
  getRevision: () => number
  setTranscriptLoading: (loading: boolean) => void
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
  let runId: string | null = options.runId ?? null
  let awaitingRun = false
  let pendingCancel = false
  let ignoreStreamEvents = false
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
  const pendingToolDeltas = new Map<
    string,
    { toolCallId: string; name?: string; argumentsDelta: string }
  >()
  const toolContentCache = new Map<string, string>()
  const thinkingCollapsedByUser = new Set<string>()

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
      return items.map((item, i) =>
        i === existingIdx && item.kind === 'tool'
          ? withCanonicalToolId(
              {
                ...item,
                tool: {
                  ...item.tool,
                  name: toolName || item.tool.name,
                  argsPreview,
                  summary: summarized || item.tool.summary || ''
                }
              },
              event.toolCallId
            )
          : item
      )
    }
    return appendTool(
      items,
      {
        kind: 'tool' as const,
        id: event.toolCallId,
        tool: {
          id: event.toolCallId,
          name: toolName || 'tool',
          summary: summarized,
          status: 'running' as const,
          argsPreview: event.argumentsDelta
        }
      },
      runStartedAt
    )
  }

  const applyStreamingPatches = (): void => {
    let items = state.items
    let changed = false

    if (pendingToolDeltas.size > 0) {
      const deltas = [...pendingToolDeltas.values()]
      pendingToolDeltas.clear()
      for (const delta of deltas) {
        items = applyToolCallDelta(items, delta, state.runStartedAt)
      }
      changed = true
    }

    if (pendingThinkingDelta && assistantId) {
      const text = pendingThinkingDelta
      pendingThinkingDelta = ''
      const id = assistantId
      const exists = items.some((item) => item.kind === 'message' && item.id === id)
      if (!exists) {
        items = insertAssistantItem(items, {
          kind: 'message',
          id,
          role: 'assistant',
          content: '',
          thinking: text,
          thinkingStreaming: true,
          thinkingExpanded: !thinkingCollapsedByUser.has(id),
          streaming: false
        })
      } else {
        items = items.map((item) =>
          item.kind === 'message' && item.id === id
            ? {
                ...item,
                thinking: (item.thinking ?? '') + text,
                thinkingStreaming: true,
                thinkingExpanded: thinkingCollapsedByUser.has(id)
                  ? item.thinkingExpanded
                  : true
              }
            : item
        )
      }
      changed = true
    } else {
      pendingThinkingDelta = ''
    }

    if (pendingTextDelta && assistantId) {
      const text = pendingTextDelta
      pendingTextDelta = ''
      const id = assistantId
      const exists = items.some((item) => item.kind === 'message' && item.id === id)
      if (!exists) {
        items = insertAssistantItem(items, {
          kind: 'message',
          id,
          role: 'assistant',
          content: text,
          streaming: true
        })
      } else {
        items = items.map((item) =>
          item.kind === 'message' && item.id === id
            ? { ...item, content: item.content + text, streaming: true }
            : item
        )
      }
      changed = true
    } else {
      pendingTextDelta = ''
    }

    if (changed) patch({ items })
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

  const flushPendingToolDeltas = (): void => {
    flushStreamingPatches()
  }

  const flushPendingTextDelta = (): void => {
    flushStreamingPatches()
  }

  const scheduleToolCallDelta = (
    event: Extract<AgentEvent, { type: 'tool_call_delta' }>
  ): void => {
    const existing = pendingToolDeltas.get(event.toolCallId)
    if (existing) {
      existing.argumentsDelta += event.argumentsDelta
      if (event.name) existing.name = event.name
    } else {
      pendingToolDeltas.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        name: event.name,
        argumentsDelta: event.argumentsDelta
      })
    }
    scheduleStreamingPatch()
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
    activityRows: [],
    running: false,
    runId,
    error: null,
    runNotice: null,
    runCacheHint: null,
    contextUsage: null,
    runStartedAt: null,
    runTerminalTick: 0,
    pendingRun: false,
    transcriptLoading: false
  }

  const notify = (): void => {
    if (disposed) return
    revision += 1
    for (const listener of listeners) listener()
  }

  const getRevision = (): number => revision

  const patch = (partial: Partial<ChatStreamState>): void => {
    Object.assign(state, partial)
    notify()
  }

  const closeRun = (id: string | null | undefined): void => {
    if (!id) return
    closedRuns.add(id)
  }

  const clearSessionUi = (opts?: { preservePendingCancel?: boolean }): void => {
    assistantId = null
    runId = null
    ignoreStreamEvents = false
    usageTotals = emptyStepUsageTotals()
    toolContentCache.clear()
    if (!opts?.preservePendingCancel) pendingCancel = false
    patch({
      items: [],
      messages: [],
      activityRows: [],
      error: null,
      runNotice: null,
      runCacheHint: null,
      contextUsage: null,
      runId: null,
      running: false,
      runStartedAt: null,
      pendingRun: false
    })
  }

  const assignRunId = (id: string): void => {
    if (closedRuns.has(id)) return
    const changed = runId !== id
    runId = id
    patch({ runId: id, pendingRun: false })
    if (changed) onRunIdAssigned?.(id)
  }

  const handleEvent = (event: AgentEvent): void => {
    if (closedRuns.has(event.runId)) return

    if (runId) {
      if (event.runId !== runId) return
    } else if (awaitingRun) {
      assignRunId(event.runId)
    } else {
      return
    }

    if (ignoreStreamEvents) return

    if (isActivityPanelEvent(event)) {
      patch({
        activityRows: [...state.activityRows, { at: new Date().toISOString(), event }]
      })
    }

    if (
      event.type !== 'text_delta' &&
      event.type !== 'thinking_delta' &&
      event.type !== 'tool_call_delta'
    ) {
      flushPendingTextDelta()
      flushPendingToolDeltas()
    }

    if (event.type === 'text_delta') {
      if (!assistantId) assistantId = messageUiId('assistant', state.messages.length)
      scheduleTextDelta(event.text)
      return
    } else if (event.type === 'thinking_delta') {
      if (!assistantId) assistantId = messageUiId('assistant', state.messages.length)
      scheduleThinkingDelta(event.text)
      return
    } else if (event.type === 'thinking_done') {
      flushStreamingPatches()
      const id = assistantId
      if (!id) return
      const doneAt = new Date().toISOString()
      patch({
        items: state.items.map((item) =>
          item.kind === 'message' && item.id === id
            ? {
                ...item,
                thinking: event.text ?? item.thinking,
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
      const messageAt = new Date().toISOString()
      // Keep same-turn tool stretches live when this message still has toolCalls.
      // Only close when this is a text-only follow-up (next iteration / final answer).
      const base = event.toolCalls?.length
        ? state.items
        : closeOpenGroupTimings(state.items)
      const exists = base.some((i) => i.kind === 'message' && i.id === id)
      let nextItems = base
      if (exists) {
        nextItems = base.map((item) =>
          item.kind === 'message' && item.id === id
            ? {
                ...item,
                content: event.content || item.content,
                thinking: event.thinking ?? item.thinking,
                thinkingStreaming: false,
                streaming: false,
                at: item.at ?? messageAt
              }
            : item
        )
      } else if (event.content || event.thinking || event.toolCalls?.length) {
        nextItems = insertAssistantItem(base, {
          kind: 'message',
          id,
          role: 'assistant',
          content: event.content,
          thinking: event.thinking,
          thinkingStreaming: false,
          streaming: false,
          at: messageAt
        })
      }
      const nextMessages = appendAssistantWithTools(
        state.messages,
        event.content,
        event.toolCalls,
        event.thinking
      )
      nextItems = ensureToolRowsForCalls(nextItems, event.toolCalls, state.runStartedAt)
      patch({ items: nextItems, messages: nextMessages })
    } else if (event.type === 'tool_call_delta') {
      scheduleToolCallDelta(event)
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
                    tool: {
                      ...item.tool,
                      name: event.name,
                      summary: event.summary,
                      status: 'running' as const
                    }
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
              tool: {
                id: event.toolCallId,
                name: event.name,
                summary: event.summary,
                status: 'running' as const
              }
            },
            state.runStartedAt
          )
        })
      }
    } else if (event.type === 'tool_result') {
      const items = state.items
      const existingIdx = findToolRowIndex(items, event.toolCallId, event.name)
      const existing =
        existingIdx >= 0 && items[existingIdx].kind === 'tool' ? items[existingIdx] : undefined
      let nextItems = items
      if (existing?.kind === 'tool') {
        nextItems = items.map((item, i) =>
          i === existingIdx && item.kind === 'tool'
            ? withCanonicalToolId(
                {
                  ...item,
                  tool: {
                    ...item.tool,
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
        event.content ?? event.summary
      )
      patch({
        items: closeTrailingGroupIfIdle(nextItems),
        messages: nextMessages
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
    } else if (event.type === 'compaction') {
      patch({
        runNotice: 'Context summarized to stay within the model window.'
      })
    } else if (event.type === 'step_budget') {
      patch({
        runNotice: `Approaching step limit (${event.step}/${event.maxSteps}). Wrap up or checkpoint to memory.`
      })
    } else if (event.type === 'step_usage') {
      const usage = stepUsageFromEvent(event)
      if (usage) {
        usageTotals = mergeStepUsageTotals(usageTotals, usage)
        const hint = formatCacheHintFromTotals(usageTotals)
        const partial: Partial<ChatStreamState> = {}
        if (hint) partial.runCacheHint = hint
        if (state.contextUsage) {
          partial.contextUsage = {
            ...state.contextUsage,
            stepUsage: usageTotals,
            updatedAt: new Date().toISOString()
          }
        }
        if (Object.keys(partial).length > 0) patch(partial)
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
        if (completedTurnSeq >= turnSeq) return
        // Stale terminal from a prior invoke after a follow-up send started.
        if (
          completedTurnSeq > 0 &&
          turnSeq > completedTurnSeq &&
          state.running &&
          turnSeq > runningTurnSeq
        ) {
          return
        }

        awaitingRun = false
        pendingCancel = false
        assistantId = null
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
          runCacheHint: null,
          runTerminalTick: state.runTerminalTick + 1,
          ...(event.status === 'error' && !state.error
            ? { error: lastRunErrorMessage ?? 'Run failed' }
            : {}),
          items: closeOpenGroupTimings(state.items).map((item) => {
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

  const send = async (text: string, images?: string[]): Promise<boolean> => {
    const trimmed = text.trim()
    if ((!trimmed && !images?.length) || state.running || state.transcriptLoading) return false
    if (!workspacePath) {
      patch({ error: 'Pick a workspace before starting a chat.' })
      return false
    }
    patch({ error: null, runNotice: null, runCacheHint: null })
    lastRunErrorMessage = null
    usageTotals = emptyStepUsageTotals()
    pendingCancel = false
    ignoreStreamEvents = false
    turnSeq += 1
    const content = buildUserContent(text, images)
    const user: ChatMessage = { role: 'user', content }
    const priorMessages = state.messages
    const nextMessages = messagesForNextTurn([...priorMessages, user])
    const userItemId = messageUiId('user', nextMessages.length - 1)
    const imageUrls = contentImages(content)
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
        at: sentAt
      })
    })
    assistantId = null
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
    runId = null
    awaitingRun = false
    pendingCancel = false
    patch({
      messages: kept,
      error: null,
      runId: null,
      pendingRun: false,
      running: false,
      runStartedAt: null,
      runTerminalTick: state.runTerminalTick + 1,
      activityRows: activityPanelRowsFromEvents(events),
      items: applyEventTimestamps(messagesToUiItems(kept), events)
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
    usageTotals = emptyStepUsageTotals()
    toolContentCache.clear()
    const cacheHint = summarizeStepUsageFromEvents(rows)
    const contextUsage = summarizeContextUsageFromEvents(rows)
    patch({
      messages: kept,
      error: errorFromPersisted(rows),
      runCacheHint: cacheHint,
      contextUsage,
      activityRows: activityPanelRowsFromEvents(rows),
      items: applyEventTimestamps(messagesToUiItems(kept), rows)
    })
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
    // Never clobber an in-flight live stream with a lagging disk snapshot.
    if (state.running || state.pendingRun || awaitingRun) return
    applyTranscriptUi(loaded, events)
  }

  const reattachActiveRun = async (id: string): Promise<void> => {
    if (closedRuns.has(id) || disposed) return
    // Poll/mount can race a terminal status — verify the run is still live.
    if (window.vyotiq?.listActiveRuns) {
      const active = await window.vyotiq.listActiveRuns()
      if (!active.ok || !active.data.some((entry) => entry.runId === id)) {
        await syncFromDisk(id)
        return
      }
    }
    if (closedRuns.has(id) || disposed) return
    runId = id
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
        if (eventsRes.ok) events = eventsRes.data
      }
      if (events.length > 0) {
        patch({
          items: applyEventTimestamps(state.items, events),
          activityRows: activityPanelRowsFromEvents(events)
        })
      }
      return
    }
    if (!window.vyotiq?.loadRun) return
    const res = await window.vyotiq.loadRun(workspacePath, id)
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
      if (eventsRes.ok) events = eventsRes.data
    }
    const kept = messagesForNextTurn(res.data.messages)
    patch({
      messages: kept,
      items: applyEventTimestamps(messagesToUiItems(kept), events),
      activityRows: activityPanelRowsFromEvents(events)
    })
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

  const clearError = (): void => {
    patch({ error: null })
  }

  const setThinkingExpanded = (messageId: string, expanded: boolean): void => {
    if (expanded) thinkingCollapsedByUser.delete(messageId)
    else thinkingCollapsedByUser.add(messageId)
    patch({
      items: state.items.map((item) =>
        item.kind === 'message' && item.id === messageId
          ? { ...item, thinkingExpanded: expanded }
          : item
      )
    })
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

    const id = runId
    if (!id || !window.vyotiq?.loadToolResult) return null

    const res = await window.vyotiq.loadToolResult(workspacePath, id, toolCallId)
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
    get runCacheHint() {
      return state.runCacheHint
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
    get activityRows() {
      return state.activityRows
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
    syncFromDisk,
    handleEvent,
    subscribe,
    getRevision,
    setTranscriptLoading,
    dispose
  }

  return controller
}
