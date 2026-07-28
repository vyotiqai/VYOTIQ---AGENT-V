import type { AgentEvent } from '../../shared/ipc'

const BATCH_MS = 16

type PendingSegment =
  | { kind: 'text'; text: string; invokeId?: number }
  | { kind: 'thinking'; text: string; step?: number; invokeId?: number }

export class ChatEventBatcher {
  private pendingSegments = new Map<string, PendingSegment[]>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly send: (ev: AgentEvent) => void) {}

  push(ev: AgentEvent): void {
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

    this.flush()
    this.send(ev)
  }

  private appendSegment(runId: string, segment: PendingSegment): void {
    const queue = this.pendingSegments.get(runId) ?? []
    const last = queue[queue.length - 1]
    if (
      last &&
      last.kind === segment.kind &&
      last.invokeId === segment.invokeId &&
      (segment.kind !== 'thinking' || (last.kind === 'thinking' && last.step === segment.step))
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
      for (const segment of segments) {
        if (!segment.text) continue
        if (segment.kind === 'text') {
          this.send({ type: 'text_delta', runId, text: segment.text, invokeId: segment.invokeId })
        } else {
          this.send({
            type: 'thinking_delta',
            runId,
            text: segment.text,
            step: segment.step,
            invokeId: segment.invokeId
          })
        }
      }
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
      for (const segment of segments) {
        if (!segment.text) continue
        if (segment.kind === 'text') {
          this.send({ type: 'text_delta', runId, text: segment.text, invokeId: segment.invokeId })
        } else {
          this.send({
            type: 'thinking_delta',
            runId,
            text: segment.text,
            step: segment.step,
            invokeId: segment.invokeId
          })
        }
      }
      this.pendingSegments.set(runId, [])
    }
  }
}
