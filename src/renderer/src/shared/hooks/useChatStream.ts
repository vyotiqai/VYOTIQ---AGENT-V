import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent, ChatMessage } from '@shared/ipc'
import { buildUserContent, contentDisplayText, contentImages } from '@shared/ipc'
import {
  appendAssistantWithTools,
  appendToolResult,
  messagesForNextTurn
} from '@shared/chatHistory'
import { logger } from '@shared/logger'
import { messagesToUiItems, applyEventTimestamps, type UiItem, type UiToolRow } from '@shared/transcript'
import type { PersistedEvent } from '@shared/ipc'

export type { UiItem, UiToolRow }

function newId(): string {
  return crypto.randomUUID()
}

function trailingToolGroupStart(items: UiItem[]): number {
  if (!items.length || items[items.length - 1].kind !== 'tool') return -1
  let start = items.length - 1
  while (start > 0 && items[start - 1].kind === 'tool') start--
  return start
}

function closeOpenGroupTimings(items: UiItem[], endedAt = Date.now()): UiItem[] {
  const start = trailingToolGroupStart(items)
  if (start < 0) return items
  const first = items[start]
  if (first.kind !== 'tool' || first.groupTiming?.endedAt) return items
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

/** Insert before a trailing tool group so assistant text matches reload ordering. */
function insertBeforeTrailingTools(items: UiItem[], next: UiItem | UiItem[]): UiItem[] {
  const closed = closeOpenGroupTimings(items)
  const batch = Array.isArray(next) ? next : [next]
  const start = trailingToolGroupStart(closed)
  if (start < 0) return [...closed, ...batch]
  return [...closed.slice(0, start), ...batch, ...closed.slice(start)]
}

function appendTool(prev: UiItem[], toolItem: Extract<UiItem, { kind: 'tool' }>): UiItem[] {
  const prevLast = prev[prev.length - 1]
  const isNewGroup = !prevLast || prevLast.kind !== 'tool'
  if (isNewGroup) {
    return [...prev, { ...toolItem, groupTiming: { startedAt: Date.now() } }]
  }
  return [...prev, toolItem]
}

export function useChatStream(workspacePath: string | null) {
  const [items, setItems] = useState<UiItem[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [runTerminalTick, setRunTerminalTick] = useState(0)
  const assistantIdRef = useRef<string | null>(null)
  const runIdRef = useRef<string | null>(null)
  /** Runs whose UI was abandoned or finished — ignore late events. */
  const closedRunsRef = useRef(new Set<string>())
  /** True between send() start and run id assignment (chatStart resolve or first event). */
  const awaitingRunRef = useRef(false)
  const messagesRef = useRef<ChatMessage[]>([])
  const pendingCancelRef = useRef(false)
  const workspaceRef = useRef(workspacePath)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const closeRun = useCallback((id: string | null | undefined) => {
    if (!id) return
    closedRunsRef.current.add(id)
  }, [])

  const clearSessionUi = useCallback((opts?: { preservePendingCancel?: boolean }) => {
    setItems([])
    setMessages([])
    messagesRef.current = []
    setError(null)
    setRunId(null)
    runIdRef.current = null
    setRunning(false)
    setRunStartedAt(null)
    assistantIdRef.current = null
    if (!opts?.preservePendingCancel) {
      pendingCancelRef.current = false
    }
    // Keep awaitingRunRef so an in-flight chatStart can still honor pendingCancel.
  }, [])

  // Reset chat when workspace changes (including first pick / clear).
  useEffect(() => {
    if (workspaceRef.current === workspacePath) return
    workspaceRef.current = workspacePath
    const id = runIdRef.current
    if (id) {
      closeRun(id)
      void window.vyotiq.chatCancel(id)
      pendingCancelRef.current = false
      awaitingRunRef.current = false
      clearSessionUi()
    } else if (awaitingRunRef.current) {
      pendingCancelRef.current = true
      clearSessionUi({ preservePendingCancel: true })
    } else {
      clearSessionUi()
      awaitingRunRef.current = false
    }
  }, [workspacePath, closeRun, clearSessionUi])

  useEffect(() => {
    if (!window.vyotiq?.onChatEvent) return
    return window.vyotiq.onChatEvent((event: AgentEvent) => {
      if (closedRunsRef.current.has(event.runId)) return

      if (runIdRef.current) {
        if (event.runId !== runIdRef.current) return
      } else if (awaitingRunRef.current) {
        runIdRef.current = event.runId
        setRunId(event.runId)
      } else {
        return
      }

      if (event.type === 'text_delta') {
        if (!assistantIdRef.current) {
          assistantIdRef.current = newId()
        }
        const id = assistantIdRef.current
        setItems((prev) => {
          const exists = prev.some((item) => item.kind === 'message' && item.id === id)
          if (!exists) {
            return insertBeforeTrailingTools(prev, {
              kind: 'message',
              id,
              role: 'assistant',
              content: event.text,
              streaming: true,
              at: new Date().toISOString()
            })
          }
          return closeOpenGroupTimings(prev).map((item) =>
            item.kind === 'message' && item.id === id
              ? { ...item, content: item.content + event.text, streaming: true }
              : item
          )
        })
      } else if (event.type === 'assistant_message') {
        const id = assistantIdRef.current ?? newId()
        assistantIdRef.current = null
        setItems((prev) => {
          const closed = closeOpenGroupTimings(prev)
          const exists = closed.some((i) => i.kind === 'message' && i.id === id)
          if (exists) {
            return closed.map((item) =>
              item.kind === 'message' && item.id === id
                ? { ...item, content: event.content, streaming: false }
                : item
            )
          }
          if (!event.content && event.toolCalls?.length) return closed
          if (!event.content) return closed
          return insertBeforeTrailingTools(closed, {
            kind: 'message',
            id,
            role: 'assistant',
            content: event.content,
            streaming: false,
            at: new Date().toISOString()
          })
        })
        setMessages((prev) => {
          const next = appendAssistantWithTools(prev, event.content, event.toolCalls)
          messagesRef.current = next
          return next
        })
      } else if (event.type === 'tool_call_delta') {
        setItems((prev) => {
          const existing = prev.find((i) => i.kind === 'tool' && i.id === event.toolCallId)
          if (existing?.kind === 'tool') {
            return prev.map((item) =>
              item.kind === 'tool' && item.id === event.toolCallId
                ? {
                    ...item,
                    tool: {
                      ...item.tool,
                      name: event.name || item.tool.name,
                      argsPreview: (item.tool.argsPreview ?? '') + event.argumentsDelta,
                      summary: event.name || item.tool.summary
                    }
                  }
                : item
            )
          }
          return appendTool(prev, {
            kind: 'tool' as const,
            id: event.toolCallId,
            tool: {
              id: event.toolCallId,
              name: event.name ?? 'tool',
              summary: event.name ?? 'tool',
              status: 'running' as const,
              argsPreview: event.argumentsDelta
            }
          })
        })
      } else if (event.type === 'tool_start') {
        assistantIdRef.current = null
        setItems((prev) => {
          const existing = prev.find((i) => i.kind === 'tool' && i.id === event.toolCallId)
          if (existing?.kind === 'tool') {
            return prev.map((item) =>
              item.kind === 'tool' && item.id === event.toolCallId
                ? {
                    ...item,
                    tool: {
                      ...item.tool,
                      name: event.name,
                      summary: event.summary,
                      status: 'running' as const
                    }
                  }
                : item
            )
          }
          return appendTool(prev, {
            kind: 'tool' as const,
            id: event.toolCallId,
            tool: {
              id: event.toolCallId,
              name: event.name,
              summary: event.summary,
              status: 'running' as const
            }
          })
        })
      } else if (event.type === 'tool_result') {
        setItems((prev) => {
          const existing = prev.find((i) => i.kind === 'tool' && i.id === event.toolCallId)
          if (existing?.kind === 'tool') {
            return prev.map((item) =>
              item.kind === 'tool' && item.id === event.toolCallId
                ? {
                    ...item,
                    tool: {
                      ...item.tool,
                      summary: event.summary,
                      status: event.ok ? 'done' : 'fail',
                      content: event.content ?? item.tool.content
                    }
                  }
                : item
            )
          }
          return appendTool(prev, {
            kind: 'tool' as const,
            id: event.toolCallId,
            tool: {
              id: event.toolCallId,
              name: event.name,
              summary: event.summary,
              status: event.ok ? 'done' : 'fail',
              content: event.content
            }
          })
        })
        setMessages((prev) => {
          const next = appendToolResult(
            prev,
            event.toolCallId,
            event.name,
            event.content ?? event.summary
          )
          messagesRef.current = next
          return next
        })
      } else if (event.type === 'error') {
        logger.warn('Agent run error', {
          scope: 'chat',
          correlationId: event.runId,
          code: 'AGENT_LOOP',
          err: event.message
        })
        setError(event.message)
      } else if (event.type === 'status') {
        if (event.status === 'running') {
          setRunning(true)
          setRunStartedAt((prev) => prev ?? Date.now())
        }
        if (event.status === 'done' || event.status === 'cancelled' || event.status === 'error') {
          closeRun(event.runId)
          awaitingRunRef.current = false
          setRunning(false)
          setRunId(null)
          runIdRef.current = null
          assistantIdRef.current = null
          pendingCancelRef.current = false
          setRunStartedAt(null)
          setRunTerminalTick((tick) => tick + 1)
          setItems((prev) =>
            closeOpenGroupTimings(prev).map((item) => {
              if (item.kind === 'message' && item.streaming) {
                return { ...item, streaming: false }
              }
              if (
                event.status === 'cancelled' &&
                item.kind === 'tool' &&
                item.tool.status === 'running'
              ) {
                return {
                  ...item,
                  tool: {
                    ...item.tool,
                    status: 'fail' as const,
                    content: item.tool.content ?? 'Cancelled'
                  }
                }
              }
              return item
            })
          )
        }
      }
    })
  }, [closeRun])

  const send = useCallback(
    async (text: string, images?: string[]): Promise<boolean> => {
      const trimmed = text.trim()
      if ((!trimmed && !images?.length) || running) return false
      setError(null)
      pendingCancelRef.current = false
      const content = buildUserContent(text, images)
      const user: ChatMessage = { role: 'user', content }
      const priorMessages = messagesRef.current
      const nextMessages = messagesForNextTurn([...priorMessages, user])
      setMessages(nextMessages)
      messagesRef.current = nextMessages
      const userItemId = newId()
      const imageUrls = contentImages(content)
      const displayText = contentDisplayText(content)
      setItems((prev) =>
        prependClosed(prev, {
          kind: 'message',
          id: userItemId,
          role: 'user',
          content: displayText,
          images: imageUrls.length ? imageUrls : undefined,
          at: new Date().toISOString()
        })
      )
      assistantIdRef.current = null
      closeRun(runIdRef.current)
      runIdRef.current = null
      awaitingRunRef.current = true
      setRunning(true)
      setRunStartedAt(Date.now())
      const res = await window.vyotiq.chatStart({
        messages: nextMessages,
        workspacePath
      })
      if (!res.ok) {
        awaitingRunRef.current = false
        logger.error('chatStart failed', { scope: 'chat', err: res.error })
        setError(res.error)
        setRunning(false)
        setRunStartedAt(null)
        runIdRef.current = null
        setRunId(null)
        // Roll back optimistic user turn so Composer can restore the draft cleanly.
        setMessages(priorMessages)
        messagesRef.current = priorMessages
        setItems((prev) => prev.filter((item) => item.id !== userItemId))
        return false
      }
      // Assign run id before clearing awaitingRun so late events are not dropped
      // in the gap between chatStart resolve and setState.
      if (pendingCancelRef.current) {
        pendingCancelRef.current = false
        awaitingRunRef.current = false
        closeRun(res.data.runId)
        runIdRef.current = null
        setRunId(null)
        setRunning(false)
        setRunStartedAt(null)
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
      if (!closedRunsRef.current.has(res.data.runId)) {
        runIdRef.current = res.data.runId
        setRunId(res.data.runId)
      }
      awaitingRunRef.current = false
      return true
    },
    [running, workspacePath, closeRun]
  )

  const stop = useCallback(async () => {
    const id = runIdRef.current ?? runId
    if (!id) {
      pendingCancelRef.current = true
      return
    }
    // Do not close yet — wait for status:cancelled so running clears cleanly.
    const res = await window.vyotiq.chatCancel(id)
    if (!res.ok) {
      logger.warn('chatCancel failed', {
        scope: 'chat',
        correlationId: id,
        err: res.error
      })
      setError(res.error)
    }
  }, [runId])

  const reset = useCallback(() => {
    const id = runIdRef.current ?? runId
    if (id) {
      closeRun(id)
      void window.vyotiq.chatCancel(id)
      awaitingRunRef.current = false
      clearSessionUi()
      return
    }
    if (awaitingRunRef.current) {
      pendingCancelRef.current = true
      clearSessionUi({ preservePendingCancel: true })
      return
    }
    clearSessionUi()
    awaitingRunRef.current = false
  }, [runId, closeRun, clearSessionUi])

  const loadTranscript = useCallback(
    (loaded: ChatMessage[], events?: PersistedEvent[]) => {
      const id = runIdRef.current ?? runId
      if (id) {
        closeRun(id)
        void window.vyotiq.chatCancel(id)
        pendingCancelRef.current = false
        awaitingRunRef.current = false
      } else if (awaitingRunRef.current) {
        pendingCancelRef.current = true
        awaitingRunRef.current = false
      } else {
        pendingCancelRef.current = false
      }
      const kept = messagesForNextTurn(loaded)
      setMessages(kept)
      messagesRef.current = kept
      setError(null)
      setRunId(null)
      runIdRef.current = null
      setRunning(false)
      setRunStartedAt(null)
      assistantIdRef.current = null
      setItems(applyEventTimestamps(messagesToUiItems(kept), events ?? []))
    },
    [runId, closeRun]
  )

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    items,
    messages,
    running,
    runId,
    runStartedAt,
    runTerminalTick,
    error,
    clearError,
    send,
    stop,
    reset,
    loadTranscript
  }
}
