import type { ChatMessage } from '../../../shared/ipc'
import type { ModelInfo } from '../../../shared/ipc/schemas/providers'
import { estimateMessagesTokens } from './estimate'

/**
 * Drop a complete prefix turn so we never orphan tool results
 * (assistant+toolCalls without their tool messages, or tools without the call).
 */
export function dropOldestTurn(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 2) return messages

  const first = messages[0]
  let i = 1

  if (first.role === 'user') {
    while (i < messages.length) {
      const m = messages[i]
      if (m.role === 'user') break
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const ids = new Set(m.toolCalls.map((t) => t.id))
        i++
        while (
          i < messages.length &&
          messages[i].role === 'tool' &&
          ids.has(messages[i].toolCallId ?? '')
        ) {
          i++
        }
        continue
      }
      if (m.role === 'assistant') {
        i++
        continue
      }
      if (m.role === 'tool') {
        i++
        continue
      }
      break
    }
  } else if (first.role === 'assistant' && first.toolCalls?.length) {
    const ids = new Set(first.toolCalls.map((t) => t.id))
    while (
      i < messages.length &&
      messages[i].role === 'tool' &&
      ids.has(messages[i].toolCallId ?? '')
    ) {
      i++
    }
  } else if (first.role === 'tool') {
    while (i < messages.length && messages[i].role === 'tool') i++
  }

  let next = messages.slice(Math.max(i, 1))
  while (next.length > 2 && next[0].role === 'tool') {
    next = next.slice(1)
  }
  return next.length >= 1 ? next : messages.slice(-2)
}

/** Fit history under a token budget without breaking tool-call pairs. */
export function trimHistoryToBudget(
  messages: ChatMessage[],
  historyBudget: number,
  model?: ModelInfo
): ChatMessage[] {
  let msgs = messages
  while (msgs.length > 2 && estimateMessagesTokens(msgs, model) > historyBudget) {
    const trimmed = dropOldestTurn(msgs)
    if (trimmed.length >= msgs.length) break
    msgs = trimmed
  }
  while (msgs.length > 2 && msgs[0].role === 'tool') {
    msgs = msgs.slice(1)
  }
  return msgs
}
