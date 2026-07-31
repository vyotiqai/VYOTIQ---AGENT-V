import type { ChatMessage, ContentPart, MessageContent, ModelInfo, ProviderId } from '../../../shared/ipc'
import { contentToText, providerContentParts } from '../../../shared/ipc'
import { formatError } from '../../../shared/errors'
import { normalizeOllamaHost } from '../../../shared/providers'
import { parseProviderReasoningState, normalizeEffortForOpenAiCompatReasoning } from '../../../shared/reasoning'
import { serviceTierForApiBody } from '../../../shared/domain/serviceTier'
import {
  baseModelInfo,
  looksLikeChatModel,
  normalizeOpenAiStyleModels,
  parseDataUrl
} from './normalize'
import type {
  LlmProvider,
  ListModelsRequest,
  ProviderChatRequest,
  StopReason,
  StreamChunk,
  ToolCall,
  TokenUsage
} from './types'
import { streamOpenAiResponses } from './openaiResponses'
import { normalizeStopReason } from './stopReason'
import { iterateSseJson } from './sse'
import { logProviderFailure } from './log'
import { fetchWithRetry } from './fetchWithRetry'
import {
  formatProviderHttpError,
  parseOpenRouterAffordableOutputTokens,
  scrubProviderErrorSnippet
} from './httpErrors'

export function openAiCompatMessageReasoningDelta(
  messageReasoning: string,
  accumulated: string
): string | null {
  if (!messageReasoning || messageReasoning.length <= accumulated.length) return null
  if (messageReasoning.startsWith(accumulated) && accumulated.length > 0) {
    return messageReasoning.slice(accumulated.length) || null
  }
  return accumulated ? messageReasoning : messageReasoning
}

export type OpenAiCompatOptions = {
  defaultBaseUrl: string
  extraHeaders?: Record<string, string>
  /** Relative to base, default `/models`. */
  listPath?: string
  /** Prefer language-models endpoint (xAI). */
  listLanguageModels?: boolean
  /** Ollama: only allow base64 data URLs for images. */
  ollamaVision?: boolean
  /** OpenRouter: filter models that advertise tools. */
  requireToolsParam?: boolean
  /** Request usage on final SSE chunk (OpenAI-compatible). */
  includeUsage?: boolean
  /** OpenAI: route related requests for better prompt-cache hit rate. */
  enablePromptCache?: boolean
  /** DeepSeek: enable thinking mode via extra_body fields. */
  deepseekThinking?: boolean
  /** OpenRouter: unified reasoning parameter. */
  openRouterReasoning?: boolean
}

/** Exported for tests — gate OpenAI `stream_options.include_usage` per provider. */
export function compatStreamOptions(
  opts: OpenAiCompatOptions
): { stream_options: { include_usage: true } } | Record<string, never> {
  if (opts.includeUsage === false || opts.ollamaVision) return {}
  return { stream_options: { include_usage: true } }
}

function toOpenAiContent(
  content: MessageContent,
  opts: { ollamaVision?: boolean }
): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content
  const parts: Array<Record<string, unknown>> = []
  for (const p of providerContentParts(content)) {
    if (p.type === 'text') {
      parts.push({ type: 'text', text: p.text })
      continue
    }
    if (opts.ollamaVision && !p.url.startsWith('data:')) {
      parts.push({
        type: 'text',
        text: '[image omitted: Ollama requires a base64 data URL]'
      })
      continue
    }
    parts.push({ type: 'image_url', image_url: { url: p.url } })
  }
  return parts.length === 1 && parts[0].type === 'text'
    ? String(parts[0].text)
    : parts
}

function openAiCompatReasoningFromMessage(
  message: ChatMessage,
  opts: { stripReasoningReplay?: boolean }
): {
  reasoningContent?: string
  reasoningDetails?: unknown
} {
  if (opts.stripReasoningReplay) return {}
  const state = parseProviderReasoningState(message.reasoningState)
  if (state?.kind !== 'openai_compat') return {}
  return {
    reasoningContent: state.reasoningContent,
    // Encrypted reasoning_details must not be replayed via OpenRouter — upstream
    // providers reject unverifiable rs_* blocks with HTTP 400 "Provider returned error".
    reasoningDetails: undefined
  }
}

function toOpenAiMessages(
  messages: ChatMessage[],
  system: string | undefined,
  opts: { ollamaVision?: boolean; stripReasoningReplay?: boolean }
) {
  const out: Array<Record<string, unknown>> = []
  if (system) out.push({ role: 'system', content: system })
  for (const m of messages) {
    if (m.role === 'tool') {
      if (!m.toolCallId) continue
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: typeof m.content === 'string' ? m.content : contentToText(m.content)
      })
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const { reasoningContent } = openAiCompatReasoningFromMessage(m, opts)
      out.push({
        role: 'assistant',
        content: typeof m.content === 'string' ? m.content || null : contentToText(m.content) || null,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        tool_calls: m.toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.arguments }
        }))
      })
    } else if (m.role === 'assistant') {
      const { reasoningContent } = openAiCompatReasoningFromMessage(m, opts)
      out.push({
        role: 'assistant',
        content: typeof m.content === 'string' ? m.content : contentToText(m.content),
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {})
      })
    } else {
      out.push({
        role: m.role,
        content: toOpenAiContent(m.content, opts)
      })
    }
  }
  return out
}

/** Exported for tests — parse OpenAI-compat usage including provider cache metrics. */
export function parseOpenAiCompatUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const u = raw as Record<string, unknown>
  const input =
    typeof u.prompt_tokens === 'number'
      ? u.prompt_tokens
      : typeof u.input_tokens === 'number'
        ? u.input_tokens
        : undefined
  const output =
    typeof u.completion_tokens === 'number'
      ? u.completion_tokens
      : typeof u.output_tokens === 'number'
        ? u.output_tokens
        : undefined
  const total =
    typeof u.total_tokens === 'number'
      ? u.total_tokens
      : input !== undefined && output !== undefined
        ? input + output
        : undefined

  let cachedInput: number | undefined
  if (typeof u.prompt_cache_hit_tokens === 'number') {
    cachedInput = u.prompt_cache_hit_tokens
  }
  const details = u.prompt_tokens_details
  if (details && typeof details === 'object') {
    const d = details as Record<string, unknown>
    if (typeof d.cached_tokens === 'number') cachedInput = d.cached_tokens
  }

  let reasoningTokens: number | undefined
  const completionDetails = u.completion_tokens_details
  if (completionDetails && typeof completionDetails === 'object') {
    const d = completionDetails as Record<string, unknown>
    if (typeof d.reasoning_tokens === 'number') reasoningTokens = d.reasoning_tokens
  }

  if (
    input === undefined &&
    output === undefined &&
    total === undefined &&
    cachedInput === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined
  }
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: total,
    cachedInputTokens: cachedInput,
    reasoningTokens
  }
}

/** GET JSON for model-catalog probes only (not chat streams). */
async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  providerId?: ProviderId
): Promise<unknown> {
  const logProvider = providerId ?? 'openai-compat'
  let res: Response
  try {
    res = await fetchWithRetry(url, { method: 'GET', headers, signal })
  } catch (err) {
    if (signal?.aborted) throw err
    // Local Ollama (or any catalog host) being down is expected — warn, don't ERROR-spam startup.
    logProviderFailure(logProvider, 'network', {}, { soft: true })
    throw new Error(formatError(err))
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logProviderFailure(
      logProvider,
      'http',
      { status: res.status, message: scrubProviderErrorSnippet(text) || undefined },
      { soft: true }
    )
    throw new Error(formatProviderHttpError(res.status, text, providerId))
  }
  return res.json()
}

function modelsFromOllamaTags(data: unknown): ModelInfo[] {
  const tags = data as { models?: Array<{ name?: string }> }
  const names = (tags.models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => Boolean(n))
  return names.map((name) =>
    baseModelInfo(name, {
      supportsTools: true,
      supportsVision: /llava|vision/i.test(name)
    })
  )
}

function mergeOllamaTagNames(models: ModelInfo[], names: string[]): ModelInfo[] {
  const seen = new Set(models.map((m) => m.id))
  const out = [...models]
  for (const name of names) {
    if (seen.has(name)) continue
    out.push(
      baseModelInfo(name, {
        supportsTools: true,
        supportsVision: /llava|vision/i.test(name)
      })
    )
    seen.add(name)
  }
  return out
}

function normalizeXaiLanguageModels(data: unknown): ModelInfo[] {
  const root = data as { models?: unknown[]; data?: unknown[] }
  const list = Array.isArray(root.models)
    ? root.models
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(data)
        ? data
        : []
  const out: ModelInfo[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const id = typeof row.id === 'string' ? row.id : null
    if (!id || !looksLikeChatModel(id)) continue
    const outputMods = Array.isArray(row.output_modalities)
      ? (row.output_modalities as string[])
      : ['text']
    if (!outputMods.includes('text')) continue
    const inputMods = Array.isArray(row.input_modalities)
      ? (row.input_modalities as string[])
      : ['text']
    const supportsVision = inputMods.includes('image')
    out.push(
      baseModelInfo(id, {
        displayName: typeof row.name === 'string' ? row.name : id,
        contextWindow:
          typeof row.context_window === 'number'
            ? row.context_window
            : typeof row.context_length === 'number'
              ? row.context_length
              : undefined,
        inputModalities: inputMods.filter((m) =>
          ['text', 'image', 'audio', 'file'].includes(m)
        ) as ModelInfo['inputModalities'],
        outputModalities: outputMods.filter((m) =>
          ['text', 'image'].includes(m)
        ) as ModelInfo['outputModalities'],
        supportsTools: true,
        supportsVision
      })
    )
  }
  return out
}

async function listOpenAiCompatModels(
  base: string,
  headers: Record<string, string>,
  opts: OpenAiCompatOptions,
  signal?: AbortSignal,
  providerId?: ProviderId
): Promise<ModelInfo[]> {
  const catalogProvider = providerId ?? (opts.ollamaVision ? 'ollama' : undefined)

  if (opts.listLanguageModels) {
    try {
      const data = await fetchJson(`${base}/language-models`, headers, signal, catalogProvider)
      const models = normalizeXaiLanguageModels(data)
      if (models.length) return models
    } catch {
      // fall through to /models
    }
  }

  // Ollama: prefer OpenAI /v1/models, fall back to native /api/tags when unreachable.
  if (opts.ollamaVision) {
    const host = normalizeOllamaHost(base)
    const openAiBase = `${host}/v1`
    const ollamaId = catalogProvider ?? 'ollama'
    let openAiErr: unknown
    try {
      const data = await fetchJson(`${openAiBase}/models`, headers, signal, ollamaId)
      let models = normalizeOpenAiStyleModels(data, {
        requireToolsParam: opts.requireToolsParam,
        providerId: ollamaId
      })
      try {
        const tags = await fetchJson(`${host}/api/tags`, {}, signal, ollamaId)
        const names = modelsFromOllamaTags(tags).map((m) => m.id)
        models = mergeOllamaTagNames(models, names)
      } catch {
        // Tags enrich is best-effort when OpenAI list already succeeded.
      }
      if (models.length) return models
    } catch (err) {
      openAiErr = err
    }

    try {
      const tags = await fetchJson(`${host}/api/tags`, {}, signal, ollamaId)
      const models = modelsFromOllamaTags(tags)
      if (models.length) return models
      throw new Error('Ollama /api/tags returned no models')
    } catch (tagsErr) {
      if (openAiErr) {
        throw new Error(
          `Cannot reach Ollama at ${host} (${formatError(openAiErr)}). Start the Ollama app or check the base URL.`
        )
      }
      throw new Error(
        `Ollama at ${host} returned no models (${formatError(tagsErr)}). Pull a model with \`ollama pull\`.`
      )
    }
  }

  const listPath = opts.listPath ?? '/models'
  const url =
    opts.requireToolsParam && !opts.listPath
      ? `${base}${listPath}?supported_parameters=tools`
      : `${base}${listPath}`

  const data = await fetchJson(url, headers, signal, providerId)
  return normalizeOpenAiStyleModels(data, {
    requireToolsParam: opts.requireToolsParam,
    providerId
  })
}

/** Exported for tests — build OpenAI-compat chat request body. */
export function buildOpenAiCompatBody(
  req: ProviderChatRequest,
  opts: OpenAiCompatOptions,
  providerId?: ProviderId,
  overrides?: { strictTools?: boolean; omitReasoning?: boolean }
): Record<string, unknown> {
  const strictTools =
    overrides?.strictTools !== undefined
      ? overrides.strictTools
      : req.strictTools !== false && req.tools.length > 0 && !opts.ollamaVision
  const tools = req.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      ...(strictTools ? { strict: true } : {})
    }
  }))
  const stripReasoningReplay = opts.openRouterReasoning || providerId === 'openrouter'
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toOpenAiMessages(req.messages, req.system, {
      ollamaVision: opts.ollamaVision,
      stripReasoningReplay
    }),
    tools: tools.length ? tools : undefined,
    ...(tools.length
      ? {
          tool_choice: req.toolChoice ?? 'auto',
          ...(opts.ollamaVision
            ? {}
            : { parallel_tool_calls: req.parallelToolCalls ?? true })
        }
      : {}),
    ...(req.responseFormat
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: req.responseFormat.name,
              strict: req.responseFormat.strict ?? true,
              schema: req.responseFormat.schema
            }
          }
        }
      : {}),
    stream: true,
    ...(req.maxOutputTokens && req.maxOutputTokens > 0 ? { max_tokens: req.maxOutputTokens } : {}),
    ...(opts.enablePromptCache && req.promptCacheKey
      ? { prompt_cache_key: req.promptCacheKey }
      : {}),
    ...compatStreamOptions(opts)
  }

  if (req.thinking?.enabled && !overrides?.omitReasoning) {
    if (opts.deepseekThinking || providerId === 'deepseek') {
      body.thinking = { type: 'enabled' }
      if (req.thinking.effort) body.reasoning_effort = req.thinking.effort
    } else if (opts.openRouterReasoning || providerId === 'openrouter') {
      body.reasoning = {
        effort: req.thinking.effort ?? 'medium',
        ...(req.thinking.maxTokens ? { max_tokens: req.thinking.maxTokens } : {})
      }
    } else if (providerId === 'groq') {
      body.reasoning_effort = normalizeEffortForOpenAiCompatReasoning(req.thinking.effort, 'groq')
      body.include_reasoning = true
      body.reasoning_format = req.thinking.display === 'omitted' ? 'hidden' : 'parsed'
    } else if (providerId === 'xai') {
      body.reasoning_effort = normalizeEffortForOpenAiCompatReasoning(req.thinking.effort, 'xai')
    } else if (providerId === 'ollama') {
      body.think = true
    }
  }

  const tier = serviceTierForApiBody(req.serviceTier)
  if (tier) body.service_tier = tier

  return body
}

export function createOpenAiCompatibleProvider(
  id: LlmProvider['id'],
  options: OpenAiCompatOptions | string
): LlmProvider {
  const opts: OpenAiCompatOptions =
    typeof options === 'string' ? { defaultBaseUrl: options } : options

  return {
    id,
    async listModels(req: ListModelsRequest): Promise<ModelInfo[]> {
      // Ollama is local and must never send Bearer auth (some proxies reject it).
      // Cloud OpenAI-compat providers need a key; calling without one yields opaque 401s
      // (e.g. DeepSeek "Authentication Fails (governor)").
      if (!opts.ollamaVision && !req.apiKey?.trim()) {
        throw new Error(`${id} API key not set`)
      }
      const raw = (req.baseUrl || opts.defaultBaseUrl).replace(/\/$/, '')
      const base = opts.ollamaVision ? `${normalizeOllamaHost(raw)}/v1` : raw
      const headers: Record<string, string> = { ...(opts.extraHeaders ?? {}) }
      if (!opts.ollamaVision && req.apiKey) {
        headers.Authorization = `Bearer ${req.apiKey}`
      }
      return listOpenAiCompatModels(base, headers, opts, req.signal, id)
    },
    async *streamChat(req: ProviderChatRequest): AsyncGenerator<StreamChunk> {
      if (!opts.ollamaVision && !req.apiKey?.trim()) {
        yield { type: 'error', error: `${id} API key not set` }
        return
      }
      const raw = (req.baseUrl || opts.defaultBaseUrl).replace(/\/$/, '')
      const base = opts.ollamaVision ? `${normalizeOllamaHost(raw)}/v1` : raw
      const url = `${base}/chat/completions`

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(opts.extraHeaders ?? {})
      }
      if (!opts.ollamaVision && req.apiKey) {
        headers.Authorization = `Bearer ${req.apiKey}`
      }

      let maxOutputTokens = req.maxOutputTokens
      let res: Response | undefined
      let bodyOverrides: { strictTools?: boolean; omitReasoning?: boolean } | undefined
      let lastHttpErrorText = ''

      for (let attempt = 0; attempt < 3; attempt++) {
        const body = buildOpenAiCompatBody(
          { ...req, maxOutputTokens },
          opts,
          id,
          bodyOverrides
        )
        try {
          res = await fetchWithRetry(url, {
            method: 'POST',
            headers,
            signal: req.signal,
            body: JSON.stringify(body)
          })
        } catch (err) {
          if (req.signal.aborted) throw err
          logProviderFailure(id, 'network', {})
          yield { type: 'error', error: formatError(err), errorCode: 'PROVIDER_NETWORK' }
          return
        }

        if (res.ok) break

        const text = await res.text().catch(() => '')
        lastHttpErrorText = text
        const affordable =
          id === 'openrouter' && res.status === 402
            ? parseOpenRouterAffordableOutputTokens(text)
            : undefined
        if (
          attempt === 0 &&
          affordable &&
          (maxOutputTokens === undefined || affordable < maxOutputTokens)
        ) {
          maxOutputTokens = affordable
          continue
        }

        // OpenRouter/OpenAI-compat 400: one fallback without strict tools, then
        // without reasoning — mirrors Anthropic's 400 field-stripping retries.
        if (
          res.status === 400 &&
          (id === 'openrouter' || opts.openRouterReasoning)
        ) {
          if (bodyOverrides?.strictTools !== false && req.tools.length > 0 && !bodyOverrides) {
            bodyOverrides = { strictTools: false }
            continue
          }
          if (!bodyOverrides?.omitReasoning && req.thinking?.enabled) {
            bodyOverrides = { strictTools: false, omitReasoning: true }
            continue
          }
        }

        const message = formatProviderHttpError(res.status, text, id)
        logProviderFailure(id, 'http', {
          status: res.status,
          message: scrubProviderErrorSnippet(text) || message,
          model: req.model
        })
        yield { type: 'error', error: message, errorCode: 'PROVIDER_HTTP' }
        return
      }

      if (!res?.ok) {
        const status = res?.status ?? 0
        const message = formatProviderHttpError(status, lastHttpErrorText, id)
        logProviderFailure(id, 'http', {
          status,
          message: scrubProviderErrorSnippet(lastHttpErrorText) || message,
          model: req.model
        })
        yield { type: 'error', error: message, errorCode: 'PROVIDER_HTTP' }
        return
      }

      const pending = new Map<number, ToolCall>()
      let lastUsage: TokenUsage | undefined
      let reasoningContent = ''
      let reasoningDetails: unknown
      let stopReason: StopReason | undefined
      let thinkingDoneEmitted = false
      const drops = { dropped: 0 }

      const emitThinkingDoneIfNeeded = function* (): Generator<StreamChunk, void, unknown> {
        if (reasoningContent && !thinkingDoneEmitted) {
          thinkingDoneEmitted = true
          yield { type: 'thinking_done', text: reasoningContent }
        }
      }

      for await (const chunk of iterateSseJson(res, req.signal, drops)) {
        const usage = parseOpenAiCompatUsage(chunk.usage)
        if (usage) lastUsage = usage

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined
        const delta = choices?.[0]?.delta as Record<string, unknown> | undefined
        const message = choices?.[0]?.message as Record<string, unknown> | undefined

        // xAI often delivers whole tool_calls on message rather than delta args
        const wholeCalls =
          (delta?.tool_calls as Array<Record<string, unknown>> | undefined) ??
          (message?.tool_calls as Array<Record<string, unknown>> | undefined)
        const textContent =
          typeof delta?.content === 'string' && delta.content ? delta.content : null

        const reasoningDelta =
          (typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : undefined) ??
          (typeof delta?.reasoning === 'string' ? delta.reasoning : undefined)
        if (reasoningDelta) {
          reasoningContent += reasoningDelta
          yield { type: 'thinking_delta', text: reasoningDelta }
        }
        if (delta?.reasoning_details !== undefined) {
          reasoningDetails = delta.reasoning_details
        }

        const messageReasoning =
          (typeof message?.reasoning_content === 'string' ? message.reasoning_content : undefined) ??
          (typeof message?.reasoning === 'string' ? message.reasoning : undefined)
        if (messageReasoning) {
          const delta = openAiCompatMessageReasoningDelta(messageReasoning, reasoningContent)
          if (delta) {
            yield { type: 'thinking_delta', text: delta }
          }
          reasoningContent = messageReasoning
        }
        if (message?.reasoning_details !== undefined) {
          reasoningDetails = message.reasoning_details
        }

        // Prefer tool deltas before text in the same SSE frame so the UI can
        // paint tool chrome without a text-first flash.
        if (wholeCalls) {
          yield* emitThinkingDoneIfNeeded()
          for (const tc of wholeCalls) {
            const index = typeof tc.index === 'number' ? tc.index : pending.size
            const fn = tc.function as { name?: string; arguments?: string } | undefined
            const existing = pending.get(index) ?? {
              id: typeof tc.id === 'string' ? tc.id : `call_${index}`,
              name: '',
              arguments: ''
            }
            if (typeof tc.id === 'string') existing.id = tc.id
            if (fn?.name) {
              // Prefer whole name when chunk includes id (xAI whole-chunk); else append deltas
              if (tc.id && fn.name) existing.name = fn.name
              else existing.name += fn.name
            }
            if (fn?.arguments) {
              if (tc.id && fn.name && fn.arguments.startsWith('{') && !existing.arguments) {
                existing.arguments = fn.arguments
              } else if (
                tc.id &&
                fn.name &&
                existing.arguments &&
                fn.arguments.length >= existing.arguments.length &&
                !fn.arguments.startsWith(existing.arguments.slice(0, 8))
              ) {
                existing.arguments = fn.arguments
              } else {
                existing.arguments += fn.arguments
              }
            }
            pending.set(index, existing)
            yield {
              type: 'tool_call_delta',
              toolCallDelta: {
                index,
                id: typeof tc.id === 'string' ? tc.id : undefined,
                name: fn?.name,
                arguments: fn?.arguments
              }
            }
          }
        }

        if (textContent) {
          yield* emitThinkingDoneIfNeeded()
          yield { type: 'text', text: textContent }
        }

        const finish = choices?.[0]?.finish_reason
        if (finish) stopReason = normalizeStopReason(finish)
        if (finish === 'tool_calls' && pending.size > 0) {
          for (const call of pending.values()) {
            yield { type: 'tool_call', toolCall: call }
          }
          pending.clear()
        }
      }

      for (const call of pending.values()) {
        yield { type: 'tool_call', toolCall: call }
      }
      if (reasoningContent && !thinkingDoneEmitted) {
        yield { type: 'thinking_done', text: reasoningContent }
      }
      yield {
        type: 'done',
        usage: lastUsage,
        stopReason,
        malformedChunks: drops.dropped || undefined,
        reasoningState:
          reasoningContent || reasoningDetails !== undefined
            ? {
                kind: 'openai_compat' as const,
                reasoningContent: reasoningContent || undefined,
                reasoningDetails
              }
            : undefined
      }
    }
  }
}

export const openaiProvider: LlmProvider = {
  ...createOpenAiCompatibleProvider('openai', {
    defaultBaseUrl: 'https://api.openai.com/v1',
    enablePromptCache: true
  }),
  async *streamChat(req: ProviderChatRequest): AsyncGenerator<StreamChunk> {
    const useResponses =
      req.thinking?.enabled === true &&
      (req.modelInfo?.thinkingApi === 'responses' || /^(o[34]|gpt-5)/i.test(req.model))
    if (useResponses) {
      yield* streamOpenAiResponses(req)
      return
    }
    const base = createOpenAiCompatibleProvider('openai', {
      defaultBaseUrl: 'https://api.openai.com/v1',
      enablePromptCache: true
    })
    yield* base.streamChat(req)
  }
}
export const deepseekProvider = createOpenAiCompatibleProvider(
  'deepseek',
  {
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    deepseekThinking: true
  }
)
export const ollamaProvider = createOpenAiCompatibleProvider('ollama', {
  defaultBaseUrl: 'http://127.0.0.1:11434/v1',
  ollamaVision: true
})
export const groqProvider = createOpenAiCompatibleProvider('groq', {
  defaultBaseUrl: 'https://api.groq.com/openai/v1'
})
export const openrouterProvider = createOpenAiCompatibleProvider('openrouter', {
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  extraHeaders: {
    'HTTP-Referer': 'https://vyotiq.com',
    'X-Title': 'Vyotiq'
  },
  requireToolsParam: true,
  openRouterReasoning: true
})
export const xaiProvider = createOpenAiCompatibleProvider('xai', {
  defaultBaseUrl: 'https://api.x.ai/v1',
  listLanguageModels: true
})
export const mistralProvider = createOpenAiCompatibleProvider('mistral', {
  defaultBaseUrl: 'https://api.mistral.ai/v1',
  /** Mistral rejects OpenAI `stream_options.include_usage`. */
  includeUsage: false
})

/** Exported for tests / multimodal mapping checks. */
export function mapOpenAiContentParts(
  parts: ContentPart[],
  ollamaVision?: boolean
): string | Array<Record<string, unknown>> {
  return toOpenAiContent(parts, { ollamaVision })
}
