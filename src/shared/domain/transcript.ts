import type { AgentEvent, ChatMessage, MessageContent, PersistedEvent } from '../ipc'
import { contentDisplayText, contentFiles, contentImages, contentToText } from '../ipc'
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

/** One line of live progress from a nested sub-agent run. */
export type UiSubagentEntry = {
  kind: 'text' | 'thinking' | 'tool' | 'done'
  text: string
}

/** A document the user attached, shown as a chip instead of its extracted text. */
export type UiAttachment = {
  name: string
  mime: string
  chars: number
}

/** A gated call the agent is parked on, waiting for the reader to answer. */
export type UiToolApproval = {
  requestId: string
  toolName: string
  summary: string
  argsPreview: string
  mutating: boolean
}

export type UiItem =
  | {
      kind: 'message'
      id: string
      role: 'user' | 'assistant'
      content: string
      images?: string[]
      attachments?: UiAttachment[]
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
      /**
       * Reader's disclosure choice for the activity group this row opens. Kept on
       * the row rather than in the component so it survives list remounts.
       */
      groupExpanded?: boolean
      /** Set while this call is waiting on tool approval. */
      approval?: UiToolApproval
      /** Progress a nested sub-agent reported while this call ran. */
      subagent?: UiSubagentEntry[]
    }

/** Attachment chips for a message: names and sizes only, never the quoted text. */
export function uiAttachments(content: MessageContent): UiAttachment[] {
  return contentFiles(content).map((file) => ({
    name: file.name,
    mime: file.mime,
    chars: file.text.length
  }))
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

type AssistantMessageItem = Extract<UiItem, { kind: 'message' }> & { role: 'assistant' }

/** True when reasoning text is worth showing (not empty or placeholder punctuation). */
export function isMeaningfulThinking(text: string | undefined): boolean {
  if (!text) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/^[.…,;:!?\-–—\s]+$/.test(trimmed)) return false
  return trimmed.length >= 2
}

/**
 * Long enough that matching the reasoning means the model really did emit the
 * same passage twice, rather than two rows happening to share a short phrase.
 */
const DUPLICATE_TEXT_MIN_CHARS = 40

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Hide assistant text that only repeats the reasoning already shown beside it.
 *
 * Nothing else is hidden. The narration a tool loop produces between batches is
 * the model's running commentary on its own work, and it streams in live, so
 * suppressing it is what leaves a multi-minute turn looking like a frozen page.
 */
export function duplicatesReasoning(item: UiItem): boolean {
  if (item.kind !== 'message' || item.role !== 'assistant') return false
  const content = item.content?.trim()
  if (!content || content.length < DUPLICATE_TEXT_MIN_CHARS) return false
  if (!isMeaningfulThinking(item.thinking)) return false
  return collapseWhitespace(item.thinking ?? '').includes(collapseWhitespace(content))
}

/**
 * Drop model-emitted pseudo tool calls that leaked into the text channel
 * (e.g. `tool {"edits":[...]}`) so they do not render as plain transcript text.
 */
export function stripToolShapedAssistantText(content: string): string {
  if (!content) return content
  let result = ''
  let i = 0
  while (i < content.length) {
    const match = content.slice(i).match(/^(\s*)tool\s*\{/)
    if (!match) {
      result += content[i]!
      i += 1
      continue
    }
    i += match[0].length
    let depth = 1
    while (i < content.length && depth > 0) {
      const ch = content[i]!
      i += 1
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
    }
    while (i < content.length && (content[i] === ' ' || content[i] === '\t')) i += 1
    if (content[i] === '\r') i += 1
    if (content[i] === '\n') i += 1
  }
  return result.replace(/\n{3,}/g, '\n\n').trim()
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

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user') {
      const images = contentImages(m.content)
      const attachments = uiAttachments(m.content)
      items.push({
        kind: 'message',
        id: messageUiId('user', i),
        role: 'user',
        content: contentDisplayText(m.content),
        images: images.length ? images : undefined,
        attachments: attachments.length ? attachments : undefined
      })
      continue
    }

    if (m.role === 'assistant') {
      const text = contentDisplayText(m.content)
      // Each step keeps its own reasoning, right above the calls it explains.
      // Pooling a turn's steps into one row buries the work under a wall of text.
      if (text || m.thinking) {
        items.push({
          kind: 'message',
          id: messageUiId('assistant', i),
          role: 'assistant',
          content: text,
          thinking: m.thinking
        })
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
          status: inferToolStatus(m.content, m.ok),
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
      if (!Number.isNaN(startedMs)) {
        out[groupStart] = {
          ...first,
          groupTiming: {
            startedAt: startedMs,
            ...(endedMs !== undefined && !Number.isNaN(endedMs) ? { endedAt: endedMs } : {})
          }
        }
      }
    }
  }
  return out
}

const MAX_SUBAGENT_REPLAY_ENTRIES = 40

function applySubagentUpdates(items: UiItem[], events: PersistedEvent[]): UiItem[] {
  const out = [...items]
  for (const row of events) {
    if (!isAgentEvent(row.event)) continue
    if (row.event.type !== 'subagent_update') continue
    const parentToolCallId = row.event.parentToolCallId
    const idx = out.findIndex((item) => item.kind === 'tool' && item.id === parentToolCallId)
    if (idx < 0) continue
    const item = out[idx]
    if (item.kind !== 'tool') continue
    const entries = [...(item.subagent ?? []), { kind: row.event.kind, text: row.event.text }]
    out[idx] = { ...item, subagent: entries.slice(-MAX_SUBAGENT_REPLAY_ENTRIES) }
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

  return applySubagentUpdates(
    withTools.map((item) => {
      if (item.kind !== 'message') return item
      const at = messageAtById.get(item.id)
      return at ? { ...item, at } : item
    }),
    events
  )
}

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
