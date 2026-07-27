import type { ChatMessage, MessageContent, ModelInfo } from '../../../shared/ipc'
import { contentToText, providerContentParts } from '../../../shared/ipc'
import { formatError } from '../../../shared/errors'
import { baseModelInfo, looksLikeChatModel, parseDataUrl } from './normalize'
import type {
  LlmProvider,
  ListModelsRequest,
  ProviderChatRequest,
  StopReason,
  StreamChunk,
  ToolCall,
  TokenUsage
} from './types'
import { normalizeStopReason } from './stopReason'
import { iterateSseJson } from './sse'
import { logProviderFailure } from './log'
import { fetchWithRetry } from './fetchWithRetry'
import { formatProviderHttpError } from './httpErrors'
import { streamGeminiInteractions } from './geminiInteractions'

/** Exported for tests — parse Gemini usage metadata including implicit cache hits. */
export function parseGeminiUsage(usageMetadata: Record<string, unknown>): TokenUsage {
  const cached =
    typeof usageMetadata.cachedContentTokenCount === 'number'
      ? usageMetadata.cachedContentTokenCount
      : typeof usageMetadata.cached_content_token_count === 'number'
        ? usageMetadata.cached_content_token_count
        : undefined
  return {
    inputTokens:
      typeof usageMetadata.promptTokenCount === 'number'
        ? usageMetadata.promptTokenCount
        : typeof usageMetadata.prompt_token_count === 'number'
          ? usageMetadata.prompt_token_count
          : undefined,
    outputTokens:
      typeof usageMetadata.candidatesTokenCount === 'number'
        ? usageMetadata.candidatesTokenCount
        : typeof usageMetadata.candidates_token_count === 'number'
          ? usageMetadata.candidates_token_count
          : undefined,
    totalTokens:
      typeof usageMetadata.totalTokenCount === 'number'
        ? usageMetadata.totalTokenCount
        : typeof usageMetadata.total_token_count === 'number'
          ? usageMetadata.total_token_count
          : undefined,
    cachedInputTokens: cached,
    reasoningTokens:
      typeof usageMetadata.thoughtsTokenCount === 'number'
        ? usageMetadata.thoughtsTokenCount
        : typeof usageMetadata.thoughts_token_count === 'number'
          ? usageMetadata.thoughts_token_count
          : undefined
  }
}

function toGeminiParts(content: MessageContent): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ text: content }]
  const parts: Array<Record<string, unknown>> = []
  for (const p of providerContentParts(content)) {
    if (p.type === 'text') {
      parts.push({ text: p.text })
      continue
    }
    const data = parseDataUrl(p.url)
    if (data) {
      parts.push({
        inlineData: { mimeType: data.mediaType, data: data.data }
      })
    } else if (p.url.startsWith('https://generativelanguage.googleapis.com/')) {
      // Gemini fileData only accepts Files API URIs, not arbitrary https links.
      parts.push({ fileData: { fileUri: p.url } })
    } else {
      parts.push({
        text: '[image omitted: Gemini requires a base64 data URL or Files API URI]'
      })
    }
  }
  return parts
}

function toGeminiContents(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const contents: Array<Record<string, unknown>> = []

  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.toolName ?? 'tool',
              ...(m.toolCallId ? { id: m.toolCallId } : {}),
              response: {
                result: typeof m.content === 'string' ? m.content : contentToText(m.content)
              }
            }
          }
        ]
      })
      continue
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const parts: Array<Record<string, unknown>> = []
      const text = typeof m.content === 'string' ? m.content : contentToText(m.content)
      if (text) parts.push({ text })
      for (const t of m.toolCalls) {
        let args: unknown = {}
        try {
          args = JSON.parse(t.arguments || '{}')
        } catch {
          args = { raw: t.arguments }
        }
        parts.push({
          functionCall: {
            name: t.name,
            args,
            ...(t.id ? { id: t.id } : {})
          }
        })
      }
      contents.push({ role: 'model', parts })
      continue
    }
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: toGeminiParts(m.content)
    })
  }

  const merged: Array<Record<string, unknown>> = []
  for (const msg of contents) {
    const last = merged[merged.length - 1]
    if (last && last.role === msg.role) {
      const lastParts = (last.parts as Array<Record<string, unknown>>) ?? []
      const nextParts = (msg.parts as Array<Record<string, unknown>>) ?? []
      last.parts = [...lastParts, ...nextParts]
    } else {
      merged.push({ ...msg, parts: [...((msg.parts as Array<Record<string, unknown>>) ?? [])] })
    }
  }
  return merged
}

/** Map loop toolChoice to Gemini functionCallingConfig.mode. */
export function geminiFunctionCallingMode(
  choice: ProviderChatRequest['toolChoice']
): 'AUTO' | 'ANY' | 'NONE' {
  if (choice === 'none') return 'NONE'
  if (choice === 'required') return 'ANY'
  return 'AUTO'
}

/** Exported for tests — build Gemini generateContent request body. */
export function buildGeminiBody(req: ProviderChatRequest): Record<string, unknown> {
  const systemParts = [
    ...(req.system ? [req.system] : []),
    ...req.messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : contentToText(m.content)))
  ]
  const tools =
    req.tools.length > 0
      ? [
          {
            functionDeclarations: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }))
          }
        ]
      : undefined
  const generationConfig: Record<string, unknown> = {}
  if (req.maxOutputTokens && req.maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = req.maxOutputTokens
  }
  if (req.responseFormat) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseSchema = req.responseFormat.schema
  }
  return {
    contents: toGeminiContents(req.messages),
    systemInstruction: systemParts.length
      ? { parts: systemParts.map((t) => ({ text: t })) }
      : undefined,
    tools,
    ...(tools
      ? {
          toolConfig: {
            functionCallingConfig: { mode: geminiFunctionCallingMode(req.toolChoice) }
          }
        }
      : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {})
  }
}

export const geminiProvider: LlmProvider = {
  id: 'gemini',
  async listModels(req: ListModelsRequest): Promise<ModelInfo[]> {
    if (!req.apiKey) throw new Error('Gemini API key not set')
    const url = 'https://generativelanguage.googleapis.com/v1beta/models'
    let res: Response
    try {
      res = await fetchWithRetry(url, {
        method: 'GET',
        headers: { 'x-goog-api-key': req.apiKey },
        signal: req.signal
      })
    } catch (err) {
      if (req.signal?.aborted) throw err
      logProviderFailure('gemini', 'network', {})
      throw new Error(formatError(err))
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logProviderFailure('gemini', 'http', { status: res.status })
      throw new Error(formatProviderHttpError(res.status, text, 'gemini'))
    }
    const data = (await res.json()) as { models?: Array<Record<string, unknown>> }
    const out: ModelInfo[] = []
    for (const row of data.models ?? []) {
      const name = typeof row.name === 'string' ? row.name : null
      if (!name) continue
      const methods = row.supportedGenerationMethods as string[] | undefined
      if (methods && !methods.includes('generateContent')) continue
      const id = name.replace(/^models\//, '')
      if (!looksLikeChatModel(id)) continue
      out.push(
        baseModelInfo(id, {
          displayName: typeof row.displayName === 'string' ? row.displayName : id,
          contextWindow:
            typeof row.inputTokenLimit === 'number' ? row.inputTokenLimit : undefined,
          maxOutputTokens:
            typeof row.outputTokenLimit === 'number' ? row.outputTokenLimit : undefined,
          supportsTools: true,
          supportsVision: /gemini|vision|flash|pro/i.test(id)
        })
      )
    }
    return out
  },
  async *streamChat(req: ProviderChatRequest): AsyncGenerator<StreamChunk> {
    const useInteractions =
      req.modelInfo?.thinkingApi === 'interactions' ||
      (req.thinking?.enabled && /gemini-(2\.5|3)/i.test(req.model))
    if (useInteractions) {
      yield* streamGeminiInteractions(req)
      return
    }

    if (!req.apiKey) {
      yield { type: 'error', error: 'Gemini API key not set' }
      return
    }

    const systemParts = [
      ...(req.system ? [req.system] : []),
      ...req.messages
        .filter((m) => m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : contentToText(m.content)))
    ]
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`

    const tools =
      req.tools.length > 0
        ? [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters
              }))
            }
          ]
        : undefined

    const generationConfig: Record<string, unknown> = {}
    if (req.maxOutputTokens && req.maxOutputTokens > 0) {
      generationConfig.maxOutputTokens = req.maxOutputTokens
    }
    if (req.responseFormat) {
      generationConfig.responseMimeType = 'application/json'
      generationConfig.responseSchema = req.responseFormat.schema
    }

    let res: Response
    try {
      res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': req.apiKey
        },
        signal: req.signal,
        body: JSON.stringify({
          contents: toGeminiContents(req.messages),
          systemInstruction: systemParts.length
            ? { parts: systemParts.map((t) => ({ text: t })) }
            : undefined,
          tools,
          ...(tools
            ? {
                toolConfig: {
                  functionCallingConfig: { mode: geminiFunctionCallingMode(req.toolChoice) }
                }
              }
            : {}),
          ...(Object.keys(generationConfig).length ? { generationConfig } : {})
        })
      })
    } catch (err) {
      if (req.signal.aborted) throw err
      logProviderFailure('gemini', 'network', {})
      yield { type: 'error', error: formatError(err) }
      return
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logProviderFailure('gemini', 'http', { status: res.status })
      yield { type: 'error', error: formatProviderHttpError(res.status, text, 'gemini') }
      return
    }

    let toolIndex = 0
    let lastUsage: TokenUsage | undefined
    let stopReason: StopReason | undefined
    const pendingCalls = new Map<string, ToolCall>()
    const drops = { dropped: 0 }

    for await (const event of iterateSseJson(res, req.signal, drops)) {
      if (event.error) {
        const errObj = event.error as { message?: string } | string
        const message =
          typeof errObj === 'string' ? errObj : (errObj.message ?? 'Gemini stream error')
        logProviderFailure('gemini', 'stream', {})
        yield {
          type: 'error',
          error: message
        }
        return
      }

      const um = event.usageMetadata as Record<string, unknown> | undefined
      if (um) {
        lastUsage = parseGeminiUsage(um)
      }

      const candidates = event.candidates as Array<Record<string, unknown>> | undefined
      const finishReason = candidates?.[0]?.finishReason
      if (finishReason) stopReason = normalizeStopReason(finishReason)
      const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as
        | Array<Record<string, unknown>>
        | undefined
      if (!parts) continue

      for (const part of parts) {
        if (typeof part.text === 'string' && part.text) {
          yield { type: 'text', text: part.text }
        }
        const fc = part.functionCall as { name?: string; args?: unknown; id?: string } | undefined
        if (fc?.name) {
          const id =
            typeof fc.id === 'string' && fc.id ? fc.id : `gemini_${fc.name}_${toolIndex}`
          const argsJson = JSON.stringify(fc.args ?? {})
          const existing = pendingCalls.get(id)
          if (existing) {
            existing.arguments = argsJson
          } else {
            pendingCalls.set(id, {
              id: typeof fc.id === 'string' && fc.id ? fc.id : `gemini_${toolIndex++}`,
              name: fc.name,
              arguments: argsJson
            })
          }
        }
      }
    }

    for (const call of pendingCalls.values()) {
      yield { type: 'tool_call', toolCall: call }
    }

    yield {
      type: 'done',
      usage: lastUsage,
      stopReason,
      malformedChunks: drops.dropped || undefined
    }
  }
}
