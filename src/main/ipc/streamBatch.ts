import type { AgentEvent } from '../../shared/ipc'

const BATCH_MS = 16

type PendingSegment =
  | { kind: 'text'; text: string; invokeId?: number }
  | { kind: 'thinking'; text: string; step?: number; invokeId?: number }
  | {
      kind: 'tool_call_delta'
      toolCallId: string
      name?: string
      argumentsDelta: string
      invokeId?: number
    }

/** Dev/test counters for IPC send rate (Electron: measure before optimizing). */
export type ChatEventBatchStats = {
  pushed: number
  sent: number
  byType: Record<string, number>
}

let stats: ChatEventBatchStats = { pushed: 0, sent: 0, byType: {} }

export function getChatEventBatchStats(): ChatEventBatchStats {
  return {
    pushed: stats.pushed,
    sent: stats.sent,
    byType: { ...stats.byType }
  }
}

export function resetChatEventBatchStats(): void {
  stats = { pushed: 0, sent: 0, byType: {} }
}

function recordPush(type: string): void {
  stats.pushed += 1
  stats.byType[type] = (stats.byType[type] ?? 0) + 1
}

function recordSend(type: string): void {
  stats.sent += 1
  const key = `sent:${type}`
  stats.byType[key] = (stats.byType[key] ?? 0) + 1
}

export class ChatEventBatcher {
  private pendingSegments = new Map<string, PendingSegment[]>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly send: (ev: AgentEvent) => void) {}

  push(ev: AgentEvent): void {
    recordPush(ev.type)

    if (ev.type === 'text_delta') {
      this.appendSegment(ev.runId, { kind: 'text', text: ev.text, invokeId: ev.invokeId })
      this.schedule()
      return
    }

    if (ev.type === 'thinking_delta') {
      this.appendSegment(ev.runId, {
        kind: 'thinking',
        text: ev.text,
        step: ev.step,
        invokeId: ev.invokeId
      })
      this.schedule()
      return
    }

    if (ev.type === 'tool_call_delta') {
      this.appendSegment(ev.runId, {
        kind: 'tool_call_delta',
        toolCallId: ev.toolCallId,
        name: ev.name,
        argumentsDelta: ev.argumentsDelta,
        invokeId: ev.invokeId
      })
      this.schedule()
      return
    }

    this.flush()
    this.emit(ev)
  }

  private emit(ev: AgentEvent): void {
    recordSend(ev.type)
    this.send(ev)
  }

  private appendSegment(runId: string, segment: PendingSegment): void {
    const queue = this.pendingSegments.get(runId) ?? []
    const last = queue[queue.length - 1]
    if (
      last &&
      last.kind === segment.kind &&
      last.invokeId === segment.invokeId &&
      (segment.kind !== 'thinking' || (last.kind === 'thinking' && last.step === segment.step)) &&
      (segment.kind !== 'tool_call_delta' ||
        (last.kind === 'tool_call_delta' && last.toolCallId === segment.toolCallId))
    ) {
      if (segment.kind === 'thinking' && last.kind === 'thinking') {
        queue[queue.length - 1] = {
          kind: 'thinking',
          text: last.text + segment.text,
          step: segment.step,
          invokeId: segment.invokeId
        }
      } else if (segment.kind === 'text' && last.kind === 'text') {
        queue[queue.length - 1] = {
          kind: 'text',
          text: last.text + segment.text,
          invokeId: segment.invokeId
        }
      } else if (segment.kind === 'tool_call_delta' && last.kind === 'tool_call_delta') {
        queue[queue.length - 1] = {
          kind: 'tool_call_delta',
          toolCallId: last.toolCallId,
          name: segment.name ?? last.name,
          argumentsDelta: last.argumentsDelta + segment.argumentsDelta,
          invokeId: segment.invokeId
        }
      }
    } else {
      queue.push(segment)
    }
    this.pendingSegments.set(runId, queue)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    for (const [runId, segments] of this.pendingSegments) {
      this.emitSegments(runId, segments)
    }
    this.pendingSegments.clear()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flushDeltas()
    }, BATCH_MS)
  }

  private flushDeltas(): void {
    for (const [runId, segments] of this.pendingSegments) {
      if (!segments.length) continue
      this.emitSegments(runId, segments)
      this.pendingSegments.set(runId, [])
    }
  }

  private emitSegments(runId: string, segments: PendingSegment[]): void {
    for (const segment of segments) {
      if (segment.kind === 'text') {
        if (!segment.text) continue
        this.emit({ type: 'text_delta', runId, text: segment.text, invokeId: segment.invokeId })
      } else if (segment.kind === 'thinking') {
        if (!segment.text) continue
        this.emit({
          type: 'thinking_delta',
          runId,
          text: segment.text,
          step: segment.step,
          invokeId: segment.invokeId
        })
      } else {
        this.emit({
          type: 'tool_call_delta',
          runId,
          toolCallId: segment.toolCallId,
          name: segment.name,
          argumentsDelta: segment.argumentsDelta,
          invokeId: segment.invokeId
        })
      }
    }
  }
}
