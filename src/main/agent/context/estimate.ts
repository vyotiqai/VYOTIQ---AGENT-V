import type { ChatMessage, MessageContent } from '../../../shared/ipc'
import { contentToText } from '../../../shared/ipc'
import type { ModelInfo } from '../../../shared/ipc/schemas/providers'
import type { TokenUsage } from '../providers/types'

export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function estimateContentTokens(content: MessageContent): number {
  if (typeof content === 'string') return estimateTextTokens(content)
  let n = 0
  for (const part of content) {
    if (part.type === 'text') n += estimateTextTokens(part.text)
    else n += 800
  }
  return n
}

export function estimateMessagesTokens(
  messages: ChatMessage[],
  _model?: ModelInfo
): number {
  let n = 0
  for (const message of messages) {
    n += estimateContentTokens(message.content)
    if (message.thinking) n += estimateTextTokens(message.thinking)
    if (message.reasoningState) {
      n += estimateTextTokens(JSON.stringify(message.reasoningState))
    }
    if (message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        n += estimateTextTokens(toolCall.name) + estimateTextTokens(toolCall.arguments)
      }
    }
    if (message.role === 'tool') {
      n += estimateTextTokens(message.toolName ?? '') + estimateTextTokens(contentToText(message.content))
    }
  }
  return n
}

export function effectiveInputTokens(estimated: number, lastUsage?: TokenUsage): number {
  if (lastUsage?.inputTokens && lastUsage.inputTokens > 0) return lastUsage.inputTokens
  if (lastUsage?.totalTokens && lastUsage.totalTokens > 0) {
    return lastUsage.totalTokens - (lastUsage.outputTokens ?? 0)
  }
  return estimated
}

export function blendInputTokens(estimated: number, lastUsage?: TokenUsage): number {
  const provider = effectiveInputTokens(estimated, lastUsage)
  return Math.max(estimated, provider)
}

export function messagePreview(message: ChatMessage): string {
  return contentToText(message.content).slice(0, 200)
}
