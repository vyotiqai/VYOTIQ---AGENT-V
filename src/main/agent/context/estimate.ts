import type { ChatMessage, MessageContent } from '../../../shared/ipc'
import { attachedFileToText, contentToText } from '../../../shared/ipc'
import type { ModelInfo } from '../../../shared/ipc/schemas/providers'
import type { TokenUsage } from '../providers/types'
import { estimateImageTokens } from './imageTokens'
import { countTextTokens, encodingForModel, type EncodingName } from './tokenizer'

export function estimateTextTokens(text: string, model?: ModelInfo): number {
  return countTextTokens(text, encodingForModel(model))
}

export function estimateContentTokens(content: MessageContent, model?: ModelInfo): number {
  return countContentTokens(content, encodingForModel(model))
}

function countContentTokens(content: MessageContent, encoding: EncodingName): number {
  if (typeof content === 'string') return countTextTokens(content, encoding)
  let n = 0
  for (const part of content) {
    if (part.type === 'image_url') n += estimateImageTokens(part.url)
    else if (part.type === 'file') n += countTextTokens(attachedFileToText(part), encoding)
    else n += countTextTokens(part.text, encoding)
  }
  return n
}

export function estimateMessagesTokens(messages: ChatMessage[], model?: ModelInfo): number {
  const encoding = encodingForModel(model)
  let n = 0
  for (const message of messages) {
    n += estimateOneMessageTokens(message, encoding)
  }
  return n
}

const messageTokenCache = new WeakMap<object, { encoding: EncodingName; tokens: number }>()

function estimateOneMessageTokens(message: ChatMessage, encoding: EncodingName): number {
  const cached = messageTokenCache.get(message)
  if (cached && cached.encoding === encoding) return cached.tokens

  let n = countContentTokens(message.content, encoding)
  if (message.thinking) n += countTextTokens(message.thinking, encoding)
  if (message.reasoningState) {
    n += countTextTokens(JSON.stringify(message.reasoningState), encoding)
  }
  if (message.toolCalls) {
    for (const toolCall of message.toolCalls) {
      n +=
        countTextTokens(toolCall.name, encoding) + countTextTokens(toolCall.arguments, encoding)
    }
  }
  if (message.role === 'tool') {
    n +=
      countTextTokens(message.toolName ?? '', encoding) +
      countTextTokens(contentToText(message.content), encoding)
  }
  messageTokenCache.set(message, { encoding, tokens: n })
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
