import type { ChatMessage } from '../../../shared/ipc'
import { contentToText } from '../../../shared/ipc'
import { formatError } from '../../../shared/errors'
import {
  normalizeEffortForOpenAiResponses,
  trailingToolMessages,
  type ProviderReasoningState
} from '../../../shared/reasoning'
import { serviceTierForApiBody } from '../../../shared/domain/serviceTier'
import type { ProviderChatRequest, StreamChunk, ToolCall, TokenUsage } from './types'
import { iterateSseJson } from './sse'
import { logProviderFailure } from './log'
import { fetchWithRetry } from './fetchWithRetry'

function toolOutputsFromMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages
    .filter((m) => m.role === 'tool')
    .map((m) => ({
      type: 'function_call_output',
      call_id: m.toolCallId,
      output: typeof m.content === 'string' ? m.content : contentToText(m.content)
    }))
}

export function toResponsesInput(
  messages: ChatMessage[],
  system: string | undefined,
  priorState?: ProviderReasoningState
): Array<Record<string, unknown>> {
  // Stateful continuation: server retains prior turn via previous_response_id.
  if (priorState?.kind === 'openai_responses' && priorState.responseId) {
    return toolOutputsFromMessages(trailingToolMessages(messages))
  }

  const out: Array<Record<string, unknown>> = []
  if (system) out.push({ role: 'developer', content: system })

  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        type: 'function_call_output',
        call_id: m.toolCallId,
        output: typeof m.content === 'string' ? m.content : contentToText(m.content)
      })
      continue
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const state = m.reasoningState as ProviderReasoningState | undefined
      if (state?.kind === 'openai_responses' && state.outputItems.length) {
        for (const item of state.outputItems) {
          if (item && typeof item === 'object') out.push(item as Record<string, unknown>)
        }
      } else {
        for (const tc of m.toolCalls) {
          out.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.name,
            arguments: tc.arguments
          })
        }
      }
      continue
    }
    if (m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : contentToText(m.content)
      if (text) out.push({ role: 'assistant', content: text })
      continue
    }
    if (m.role === 'user') {
      out.push({
        role: 'user',
        content: typeof m.content === 'string' ? m.content : contentToText(m.content)
      })
    }
  }
  return out
}

function toResponsesTools(tools: ProviderChatRequest['tools']): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: true
  }))
}

/** Stream chat via OpenAI Responses API for reasoning models. */
export async function* streamOpenAiResponses(
  req: ProviderChatRequest
): AsyncGenerator<StreamChunk> {
  if (!req.apiKey) {
    yield { type: 'error', error: 'OpenAI API key not set' }
    return
  }

  const priorState =
    req.reasoningState?.kind === 'openai_responses' ? req.reasoningState : undefined
  const thinkingEnabled = req.thinking?.enabled !== false

  const body: Record<string, unknown> = {
    model: req.model,
    input: toResponsesInput(req.messages, req.system, priorState),
    stream: true,
    store: true,
    ...(req.tools.length
      ? {
          tools: toResponsesTools(req.tools),
          tool_choice: req.toolChoice ?? 'auto',
          parallel_tool_calls: req.parallelToolCalls ?? true
        }
      : {}),
    ...(thinkingEnabled
      ? {
          reasoning: {
            effort: normalizeEffortForOpenAiResponses(req.thinking?.effort, true),
            summary: 'auto',
            context: 'all_turns'
          }
        }
      : {}),
    ...(priorState?.responseId ? { previous_response_id: priorState.responseId } : {})
  }

  const tier = serviceTierForApiBody(req.serviceTier)
  if (tier) body.service_tier = tier

  let res: Response
  try {
    res = await fetchWithRetry('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${req.apiKey}`
      },
      signal: req.signal,
      body: JSON.stringify(body)
    })
  } catch (err) {
    if (req.signal.aborted) throw err
    logProviderFailure('openai', 'network', {})
    yield { type: 'error', error: formatError(err) }
    return
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    logProviderFailure('openai', 'http', { status: res.status })
    yield { type: 'error', error: `HTTP ${res.status}: ${text.slice(0, 400)}` }
    return
  }

  const pending = new Map<string, ToolCall>()
  const outputItems: unknown[] = []
  let responseId: string | undefined
  let thinkingText = ''
  let lastUsage: TokenUsage | undefined

  for await (const event of iterateSseJson(res, req.signal)) {
    const type = event.type as string | undefined
    const response = event.response as Record<string, unknown> | undefined
    if (response && typeof response.id === 'string') responseId = response.id

    if (type === 'response.output_text.delta') {
      const delta = event.delta as string | undefined
      if (delta) yield { type: 'text', text: delta }
    }

    if (type === 'response.reasoning_summary_text.delta') {
      const delta = event.delta as string | undefined
      if (delta) {
        thinkingText += delta
        yield { type: 'thinking_delta', text: delta }
      }
    }

    if (type === 'response.output_item.done') {
      const item = event.item as Record<string, unknown> | undefined
      if (item) {
        outputItems.push(item)
        if (item.type === 'function_call') {
          const callId = String(item.call_id ?? item.id ?? `call_${pending.size}`)
          const call: ToolCall = {
            id: callId,
            name: String(item.name ?? ''),
            arguments: String(item.arguments ?? '')
          }
          pending.set(callId, call)
          yield { type: 'tool_call', toolCall: call }
        }
        if (item.type === 'reasoning') {
          const summary = item.summary as Array<{ text?: string }> | undefined
          if (summary?.length) {
            const text = summary.map((s) => s.text ?? '').join('')
            if (text && !thinkingText) {
              thinkingText = text
              yield { type: 'thinking_delta', text }
            }
          }
        }
      }
    }

    if (type === 'response.function_call_arguments.delta') {
      const callId = String(event.call_id ?? '')
      const delta = event.delta as string | undefined
      if (callId && delta) {
        const existing = pending.get(callId) ?? { id: callId, name: '', arguments: '' }
        existing.arguments += delta
        pending.set(callId, existing)
        yield {
          type: 'tool_call_delta',
          toolCallDelta: { index: pending.size, id: callId, arguments: delta }
        }
      }
    }

    if (type === 'response.completed' || type === 'response.done') {
      const usage = (event.response as Record<string, unknown> | undefined)?.usage as
        | Record<string, unknown>
        | undefined
      if (usage) {
        const details = usage.output_tokens_details as Record<string, unknown> | undefined
        lastUsage = {
          inputTokens:
            typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
          outputTokens:
            typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
          totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
          reasoningTokens:
            details && typeof details.reasoning_tokens === 'number'
              ? details.reasoning_tokens
              : undefined
        }
      }
    }
  }

  if (thinkingText) yield { type: 'thinking_done', text: thinkingText }

  yield {
    type: 'done',
    usage: lastUsage,
    reasoningState:
      outputItems.length || responseId
        ? {
            kind: 'openai_responses' as const,
            responseId,
            outputItems
          }
        : undefined
  }
}
