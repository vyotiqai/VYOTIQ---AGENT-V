import type { ChatMessage, MessageContent } from '../../../shared/ipc'
import { attachedFileToText, contentToText } from '../../../shared/ipc'
import type { ModelInfo } from '../../../shared/ipc/schemas/providers'
import type { TokenUsage } from '../providers/types'
import { estimateImageTokens } from './imageTokens'
import {
  countTextTokens,
  countTextTokensAsync,
  countTextsTokensAsync,
  encodingForModel,
  type EncodingName
} from './tokenizer'

export function estimateTextTokens(text: string, model?: ModelInfo): number {
  return countTextTokens(text, encodingForModel(model))
}

export async function estimateTextTokensAsync(text: string, model?: ModelInfo): Promise<number> {
  return countTextTokensAsync(text, encodingForModel(model))
}

export function estimateContentTokens(content: MessageContent, model?: ModelInfo): number {
  return countContentTokens(content, encodingForModel(model))
}

export async function estimateContentTokensAsync(
  content: MessageContent,
  model?: ModelInfo
): Promise<number> {
  return countContentTokensAsync(content, encodingForModel(model))
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

async function countContentTokensAsync(
  content: MessageContent,
  encoding: EncodingName
): Promise<number> {
  if (typeof content === 'string') return countTextTokensAsync(content, encoding)
  const texts: Array<{ text: string; encoding: EncodingName }> = []
  let images = 0
  for (const part of content) {
    if (part.type === 'image_url') images += estimateImageTokens(part.url)
    else if (part.type === 'file') texts.push({ text: attachedFileToText(part), encoding })
    else texts.push({ text: part.text, encoding })
  }
  const counts = await countTextsTokensAsync(texts)
  return images + counts.reduce((a, b) => a + b, 0)
}

export function estimateMessagesTokens(messages: ChatMessage[], model?: ModelInfo): number {
  const encoding = encodingForModel(model)
  let n = 0
  for (const message of messages) {
    n += estimateOneMessageTokens(message, encoding)
  }
  return n
}

export async function estimateMessagesTokensAsync(
  messages: ChatMessage[],
  model?: ModelInfo
): Promise<number> {
  const encoding = encodingForModel(model)
  // Single worker round-trip for all uncached messages (not one await per message).
  const texts: Array<{ text: string; encoding: EncodingName }> = []
  const spans: Array<{ message: ChatMessage; images: number; start: number; end: number }> = []
  let total = 0

  for (const message of messages) {
    const cached = messageTokenCache.get(message)
    if (cached && cached.encoding === encoding) {
      total += cached.tokens
      continue
    }
    const start = texts.length
    let images = 0
    if (typeof message.content === 'string') {
      texts.push({ text: message.content, encoding })
    } else {
      for (const part of message.content) {
        if (part.type === 'image_url') images += estimateImageTokens(part.url)
        else if (part.type === 'file') texts.push({ text: attachedFileToText(part), encoding })
        else texts.push({ text: part.text, encoding })
      }
    }
    if (message.thinking) texts.push({ text: message.thinking, encoding })
    if (message.reasoningState) {
      texts.push({ text: JSON.stringify(message.reasoningState), encoding })
    }
    if (message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        texts.push({ text: toolCall.name, encoding }, { text: toolCall.arguments, encoding })
      }
    }
    if (message.role === 'tool') {
      texts.push({ text: message.toolName ?? '', encoding })
    }
    spans.push({ message, images, start, end: texts.length })
  }

  if (spans.length === 0) return total

  const counts = await countTextsTokensAsync(texts)
  for (const span of spans) {
    let n = span.images
    for (let i = span.start; i < span.end; i++) n += counts[i] ?? 0
    messageTokenCache.set(span.message, { encoding, tokens: n })
    total += n
  }
  return total
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
    // toolName is not in `content`; do not re-count content (already counted above).
    n += countTextTokens(message.toolName ?? '', encoding)
  }
  messageTokenCache.set(message, { encoding, tokens: n })
  return n
}

async function estimateOneMessageTokensAsync(
  message: ChatMessage,
  encoding: EncodingName
): Promise<number> {
  const cached = messageTokenCache.get(message)
  if (cached && cached.encoding === encoding) return cached.tokens

  const texts: Array<{ text: string; encoding: EncodingName }> = []
  let images = 0

  if (typeof message.content === 'string') {
    texts.push({ text: message.content, encoding })
  } else {
    for (const part of message.content) {
      if (part.type === 'image_url') images += estimateImageTokens(part.url)
      else if (part.type === 'file') texts.push({ text: attachedFileToText(part), encoding })
      else texts.push({ text: part.text, encoding })
    }
  }
  if (message.thinking) texts.push({ text: message.thinking, encoding })
  if (message.reasoningState) {
    texts.push({ text: JSON.stringify(message.reasoningState), encoding })
  }
  if (message.toolCalls) {
    for (const toolCall of message.toolCalls) {
      texts.push({ text: toolCall.name, encoding }, { text: toolCall.arguments, encoding })
    }
  }
  if (message.role === 'tool') {
    // toolName only — content already queued above.
    texts.push({ text: message.toolName ?? '', encoding })
  }

  const counts = await countTextsTokensAsync(texts)
  const n = images + counts.reduce((a, b) => a + b, 0)
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
