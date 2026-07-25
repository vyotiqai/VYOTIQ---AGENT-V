import type { AgentEvent, ChatMessage, MessageContent, PersistedEvent } from '../ipc'
import { contentDisplayText, contentImages, contentToText } from '../ipc'
import { isAgentEvent } from '../utils/eventUtils'
import { summarizeToolArgs } from '../utils/toolSummary'

export type UiToolRow = {
  id: string
  name: string
  summary: string
  status: 'running' | 'done' | 'fail'
  content?: string
  /** Live IPC shipped a preview only; expand to lazy-load from disk. */
  contentTruncated?: boolean
  argsPreview?: string
}

export type UiGroupTiming = {
  startedAt: number
  endedAt?: number
}

export type UiItem =
  | {
      kind: 'message'
      id: string
      role: 'user' | 'assistant'
      content: string
      images?: string[]
      streaming?: boolean
      thinking?: string
      thinkingStreaming?: boolean
      thinkingExpanded?: boolean
      /** ISO timestamp when the message was sent or received. */
      at?: string
    }
  | {
      kind: 'tool'
      id: string
      tool: UiToolRow
      groupTiming?: UiGroupTiming
      at?: string
      toolExpanded?: boolean
    }

/** Stable ids so reload/sync does not remount every transcript row. */
export function messageUiId(role: 'user' | 'assistant', index: number): string {
  return `${role}-${index}`
}

function toolContentText(content: MessageContent): string {
  return typeof content === 'string' ? content : contentToText(content)
}

export function inferToolStatus(content: MessageContent, ok?: boolean): 'done' | 'fail' {
  if (ok !== undefined) return ok ? 'done' : 'fail'
  const text = toolContentText(content)
  if (text === 'Cancelled') return 'fail'
  if (!text) return 'done'
  if (/^Failed to parse tool arguments/i.test(text)) return 'fail'
  if (/^Unknown tool:/i.test(text)) return 'fail'
  if (/invalid args/i.test(text)) return 'fail'
  if (/exit_code:\s*(?!0\b)\d+/i.test(text)) return 'fail'
  return 'done'
}

/** Join a turn's reasoning steps into the single Thought row the turn renders. */
export function mergeThinking(previous: string | undefined, next: string): string {
  const before = previous?.trim() ?? ''
  const after = next.trim()
  if (!before) return after
  if (!after || before.endsWith(after)) return before
  return `${before}\n\n${after}`
}

/** Rebuild chat UI items from persisted messages (includes tool rows). */
export function messagesToUiItems(messages: ChatMessage[]): UiItem[] {
  const items: UiItem[] = []
  const pendingCalls = new Map<string, { name: string; arguments: string }>()
  // A tool-loop turn reasons once per step. All of it belongs to the turn's first
  // assistant row so the transcript shows one Thought row and one tool stretch.
  let turnReasoningIdx = -1

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user') {
      const images = contentImages(m.content)
      items.push({
        kind: 'message',
        id: messageUiId('user', i),
        role: 'user',
        content: contentDisplayText(m.content),
        images: images.length ? images : undefined
      })
      turnReasoningIdx = -1
      continue
    }

    if (m.role === 'assistant') {
      const text = contentDisplayText(m.content)
      const reasoningTarget = turnReasoningIdx >= 0 ? items[turnReasoningIdx] : undefined
      if (!text && m.thinking && reasoningTarget?.kind === 'message') {
        items[turnReasoningIdx] = {
          ...reasoningTarget,
          thinking: mergeThinking(reasoningTarget.thinking, m.thinking)
        }
      } else if (text || m.thinking) {
        items.push({
          kind: 'message',
          id: messageUiId('assistant', i),
          role: 'assistant',
          content: text,
          thinking: m.thinking
        })
        if (turnReasoningIdx < 0) turnReasoningIdx = items.length - 1
      }
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          pendingCalls.set(tc.id, { name: tc.name, arguments: tc.arguments })
          const summary = summarizeToolArgs(tc.name, tc.arguments)
          items.push({
            kind: 'tool',
            id: tc.id,
            tool: {
              id: tc.id,
              name: tc.name,
              summary,
              status: 'running',
              argsPreview: tc.arguments || undefined
            }
          })
        }
      }
      continue
    }

    if (m.role === 'tool') {
      const id = m.toolCallId ?? `tool-${i}`
      const pending = pendingCalls.get(id)
      const name = m.toolName ?? pending?.name ?? 'tool'
      const summary = summarizeToolArgs(name, pending?.arguments)
      const content = toolContentText(m.content)
      const row: Extract<UiItem, { kind: 'tool' }> = {
        kind: 'tool',
        id,
        tool: {
          id,
          name,
          summary,
          status: inferToolStatus(m.content),
          content,
          argsPreview: pending?.arguments || undefined
        }
      }
      const existingIdx = items.findIndex((item) => item.kind === 'tool' && item.id === id)
      if (existingIdx >= 0) {
        items[existingIdx] = row
      } else {
        items.push(row)
      }
      pendingCalls.delete(id)
    }
  }

  return items
}

function toolResultOk(events: PersistedEvent[]): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const row of events) {
    if (!isAgentEvent(row.event)) continue
    if (row.event.type !== 'tool_result') continue
    const id = row.event.toolCallId
    if (!id || out.has(id)) continue
    out.set(id, row.event.ok)
  }
  return out
}

function reconstructGroupTiming(items: UiItem[], events: PersistedEvent[]): UiItem[] {
  const startById = new Map<string, string>()
  const endById = new Map<string, string>()
  const itemIds = new Set(
    items.filter((item): item is Extract<UiItem, { kind: 'tool' }> => item.kind === 'tool').map((item) => item.id)
  )
  for (const row of events) {
    if (!isAgentEvent(row.event)) continue
    if (row.event.type === 'tool_start') {
      const id = row.event.toolCallId
      if (!id || !itemIds.has(id) || startById.has(id)) continue
      startById.set(id, row.at)
    }
    if (row.event.type === 'tool_result') {
      const id = row.event.toolCallId
      if (!id || !itemIds.has(id) || endById.has(id)) continue
      endById.set(id, row.at)
    }
  }

  const out = [...items]
  let i = 0
  while (i < out.length) {
    if (out[i].kind !== 'tool') {
      i++
      continue
    }
    const groupStart = i
    while (i < out.length && out[i].kind === 'tool') i++
    const first = out[groupStart] as Extract<UiItem, { kind: 'tool' }>
    const last = out[i - 1] as Extract<UiItem, { kind: 'tool' }>
    const startedAt = startById.get(first.id)
    const endedAt = endById.get(last.id)
    if (startedAt) {
      const startedMs = new Date(startedAt).getTime()
      const endedMs = endedAt ? new Date(endedAt).getTime() : undefined
      out[groupStart] = {
        ...first,
        groupTiming: {
          startedAt: startedMs,
          ...(endedMs !== undefined && !Number.isNaN(endedMs) ? { endedAt: endedMs } : {})
        }
      }
    }
  }
  return out
}

/** Attach ISO timestamps from persisted events.jsonl rows where available. */
export function applyEventTimestamps(items: UiItem[], events: PersistedEvent[]): UiItem[] {
  if (!events.length) return items
  const itemIds = new Set(
    items.filter((item): item is Extract<UiItem, { kind: 'tool' }> => item.kind === 'tool').map((item) => item.id)
  )
  const startAtById = new Map<string, string>()
  let runStartAt: string | undefined
  let runDoneAt: string | undefined
  const allAssistantMessageAts: string[] = []
  const visibleAssistantMessageAts: string[] = []

  for (const row of events) {
    if (!isAgentEvent(row.event)) continue
    if (row.event.type === 'status') {
      if (row.event.status === 'running' && !runStartAt) runStartAt = row.at
      if (
        row.event.status === 'done' ||
        row.event.status === 'error' ||
        row.event.status === 'cancelled'
      ) {
        runDoneAt = row.at
      }
    }
    if (row.event.type === 'assistant_message') {
      allAssistantMessageAts.push(row.at)
      if (row.event.content || row.event.thinking) {
        visibleAssistantMessageAts.push(row.at)
      }
    }
    if (row.event.type !== 'tool_start') continue
    const id = row.event.toolCallId
    if (!id || !itemIds.has(id) || startAtById.has(id)) continue
    startAtById.set(id, row.at)
  }
  const okById = toolResultOk(events)

  const withMeta = items.map((item) => {
    if (item.kind !== 'tool') return item
    const startAt = startAtById.get(item.id)
    const ok = okById.get(item.id)
    const withAt = startAt ? { ...item, at: startAt } : item
    if (ok === undefined) return withAt
    return {
      ...withAt,
      tool: {
        ...withAt.tool,
        status: ok ? ('done' as const) : ('fail' as const)
      }
    }
  })

  const withTools = reconstructGroupTiming(withMeta, events)
  const messageAtById = messageTimestampsFromEvents(withTools, {
    runStartAt,
    runDoneAt,
    allAssistantMessageAts,
    visibleAssistantMessageAts
  })

  return withTools.map((item) => {
    if (item.kind !== 'message') return item
    const at = messageAtById.get(item.id)
    return at ? { ...item, at } : item
  })
}

type AssistantMessageItem = Extract<UiItem, { kind: 'message' }> & { role: 'assistant' }

function messageTimestampsFromEvents(
  items: UiItem[],
  meta: {
    runStartAt?: string
    runDoneAt?: string
    allAssistantMessageAts: string[]
    visibleAssistantMessageAts: string[]
  }
): Map<string, string> {
  const out = new Map<string, string>()
  let assistantEventIdx = 0
  let visibleAssistantEventIdx = 0
  let lastTurnEndAt: string | undefined
  let turnHasVisibleAssistant = false

  for (const item of items) {
    if (item.kind === 'message' && item.role === 'user') {
      if (!out.has(item.id)) {
        if (!lastTurnEndAt && meta.runStartAt) {
          out.set(item.id, meta.runStartAt)
        } else if (lastTurnEndAt) {
          out.set(item.id, lastTurnEndAt)
        }
      }
      turnHasVisibleAssistant = false
      continue
    }

    if (item.kind === 'message' && item.role === 'assistant' && (item.content || item.thinking)) {
      if (!turnHasVisibleAssistant && assistantEventIdx < meta.allAssistantMessageAts.length) {
        assistantEventIdx += 1
        turnHasVisibleAssistant = true
      } else if (turnHasVisibleAssistant && assistantEventIdx < meta.allAssistantMessageAts.length) {
        assistantEventIdx += 1
      }
      if (visibleAssistantEventIdx < meta.visibleAssistantMessageAts.length) {
        out.set(item.id, meta.visibleAssistantMessageAts[visibleAssistantEventIdx]!)
        visibleAssistantEventIdx += 1
      }
      if (assistantEventIdx > 0) {
        lastTurnEndAt = meta.allAssistantMessageAts[assistantEventIdx - 1]
      }
      continue
    }

    if (item.kind === 'tool') {
      if (!turnHasVisibleAssistant && assistantEventIdx < meta.allAssistantMessageAts.length) {
        lastTurnEndAt = meta.allAssistantMessageAts[assistantEventIdx]!
        assistantEventIdx += 1
        turnHasVisibleAssistant = true
      }
    }
  }

  const assistantItems = items.filter(
    (item): item is AssistantMessageItem =>
      item.kind === 'message' &&
      item.role === 'assistant' &&
      Boolean(item.content || item.thinking)
  )
  for (let i = 0; i < assistantItems.length; i++) {
    const item = assistantItems[i]!
    if (out.has(item.id)) continue
    if (visibleAssistantEventIdx < meta.visibleAssistantMessageAts.length) {
      out.set(item.id, meta.visibleAssistantMessageAts[visibleAssistantEventIdx]!)
      visibleAssistantEventIdx += 1
      continue
    }
    const itemIndex = items.findIndex((entry) => entry.id === item.id)
    const nextTool = items
      .slice(itemIndex + 1)
      .find((entry): entry is Extract<UiItem, { kind: 'tool' }> => entry.kind === 'tool')
    if (nextTool?.at) {
      out.set(item.id, nextTool.at)
      continue
    }
    if (i === assistantItems.length - 1 && meta.runDoneAt) {
      out.set(item.id, meta.runDoneAt)
    }
  }

  return out
}
