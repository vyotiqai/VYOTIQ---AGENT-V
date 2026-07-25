import type { AgentEvent } from '../../shared/ipc'

const BATCH_MS = 16

export class ChatEventBatcher {
  private pendingText = new Map<string, string>()
  private pendingThinking = new Map<string, { text: string; step?: number }>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly send: (ev: AgentEvent) => void) {}

  push(ev: AgentEvent): void {
    if (ev.type === 'text_delta') {
      const prev = this.pendingText.get(ev.runId) ?? ''
      this.pendingText.set(ev.runId, prev + ev.text)
      this.schedule()
      return
    }

    if (ev.type === 'thinking_delta') {
      const prev = this.pendingThinking.get(ev.runId)
      this.pendingThinking.set(ev.runId, {
        text: (prev?.text ?? '') + ev.text,
        step: ev.step ?? prev?.step
      })
      this.schedule()
      return
    }

    this.flush()
    this.send(ev)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    for (const [runId, text] of this.pendingText) {
      if (text) this.send({ type: 'text_delta', runId, text })
    }
    this.pendingText.clear()

    for (const [runId, entry] of this.pendingThinking) {
      if (entry.text) {
        this.send({
          type: 'thinking_delta',
          runId,
          text: entry.text,
          step: entry.step
        })
      }
    }
    this.pendingThinking.clear()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flushDeltas()
    }, BATCH_MS)
  }

  private flushDeltas(): void {
    for (const [runId, text] of this.pendingText) {
      if (!text) continue
      this.send({ type: 'text_delta', runId, text })
      this.pendingText.set(runId, '')
    }

    for (const [runId, entry] of this.pendingThinking) {
      if (!entry.text) continue
      this.send({
        type: 'thinking_delta',
        runId,
        text: entry.text,
        step: entry.step
      })
      this.pendingThinking.set(runId, { text: '', step: entry.step })
    }
  }
}
