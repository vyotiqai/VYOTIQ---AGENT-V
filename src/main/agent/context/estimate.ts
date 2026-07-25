import type { ChatMessage, MessageContent } from '../../../shared/ipc'
import { contentToText } from '../../../shared/ipc'
import type { TokenUsage } from '../providers/types'

export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function estimateContentTokens(content: MessageContent): number {
  if (typeof content === 'string') return estimateTextTokens(content)
  let n = 0
  for (const p of content) {
    if (p.type === 'text') n += estimateTextTokens(p.text)
    else n += 800 // rough image token stand-in
  }
  return n
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let n = 0
  for (const m of messages) {
    n += estimateContentTokens(m.content)
    if (m.toolCalls) {
      for (const t of m.toolCalls) {
        n += estimateTextTokens(t.name) + estimateTextTokens(t.arguments)
      }
    }
  }
  return n
}

/** Prefer provider usage when present; else heuristic. */
export function effectiveInputTokens(
  estimated: number,
  lastUsage?: TokenUsage
): number {
  if (lastUsage?.inputTokens && lastUsage.inputTokens > 0) return lastUsage.inputTokens
  if (lastUsage?.totalTokens && lastUsage.totalTokens > 0) {
    return lastUsage.totalTokens - (lastUsage.outputTokens ?? 0)
  }
  return estimated
}

export function messagePreview(m: ChatMessage): string {
  return contentToText(m.content).slice(0, 200)
}
