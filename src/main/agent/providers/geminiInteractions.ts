import type { ChatMessage } from '../../../shared/ipc'
import { contentToText } from '../../../shared/ipc'
import { formatError } from '../../../shared/errors'
import {
  normalizeEffortForGeminiInteractions,
  trailingToolMessages,
  type ProviderReasoningState
} from '../../../shared/reasoning'
import type { ProviderChatRequest, StreamChunk, ToolCall, TokenUsage } from './types'
import { iterateSseJson } from './sse'
import { logProviderFailure } from './log'
import { fetchWithRetry } from './fetchWithRetry'

export function serializeToolArgs(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function toInteractionsInput(
  messages: ChatMessage[],
  system: string | undefined,
  continuing: boolean
): string | Array<Record<string, unknown>> {
  const source = continuing ? trailingToolMessages(messages) : messages
  const parts: Array<Record<string, unknown>> = []
  if (!continuing && system) parts.push({ type: 'text', text: system })

  for (const m of source) {
    if (m.role === 'user') {
      parts.push({
        type: 'text',
        text: typeof m.content === 'string' ? m.content : contentToText(m.content)
      })
    } else if (m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : contentToText(m.content)
      if (text) parts.push({ type: 'text', text })
    } else if (m.role === 'tool') {
      parts.push({
        type: 'text',
        text: `[tool:${m.toolName ?? 'tool'}] ${typeof m.content === 'string' ? m.content : contentToText(m.content)}`
      })
    }
  }

  if (parts.length === 1 && parts[0].type === 'text') return String(parts[0].text)
  if (!parts.length) return continuing ? '' : ''
  return parts
}

function toInteractionsTools(tools: ProviderChatRequest['tools']): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }))
}

/** Stream chat via Gemini Interactions API for thinking models. */
export async function* streamGeminiInteractions(
  req: ProviderChatRequest
): AsyncGenerator<StreamChunk> {
  if (!req.apiKey) {
    yield { type: 'error', error: 'Gemini API key not set' }
    return
  }

  const priorState =
    req.reasoningState?.kind === 'gemini_interactions' ? req.reasoningState : undefined
  const continuing = Boolean(priorState?.interactionId)

  const body: Record<string, unknown> = {
    model: req.model,
    input: toInteractionsInput(req.messages, req.system, continuing),
    stream: true,
    store: true,
  }

  if (req.thinking?.enabled !== false) {
    body.generation_config = {
      thinking_summaries: 'auto',
      thinking_level: normalizeEffortForGeminiInteractions(req.thinking?.effort)
    }
  }

  if (req.tools.length) body.tools = toInteractionsTools(req.tools)
  if (priorState?.interactionId) body.previous_interaction_id = priorState.interactionId

  const url = 'https://generativelanguage.googleapis.com/v1beta/interactions'
  let res: Response
  try {
    res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': req.apiKey
      },
      signal: req.signal,
      body: JSON.stringify(body)
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
    yield { type: 'error', error: `HTTP ${res.status}: ${text.slice(0, 400)}` }
    return
  }

  let interactionId: string | undefined = priorState?.interactionId
  const thoughtSteps: unknown[] = []
  const pending = new Map<string, ToolCall>()
  let thinkingText = ''
  let lastUsage: TokenUsage | undefined

  for await (const event of iterateSseJson(res, req.signal)) {
    const eventType = event.event_type as string | undefined
    const interaction = event.interaction as Record<string, unknown> | undefined
    if (interaction && typeof interaction.id === 'string') interactionId = interaction.id

    if (eventType === 'step.delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      if (!delta) continue
      if (delta.type === 'thought_summary') {
        const content = delta.content as { text?: string } | undefined
        const text = content?.text ?? ''
        if (text) {
          thinkingText += text
          yield { type: 'thinking_delta', text }
        }
      } else if (delta.type === 'text' && typeof delta.text === 'string') {
        yield { type: 'text', text: delta.text }
      } else if (delta.type === 'function_call') {
        const fn = delta.function_call as Record<string, unknown> | undefined
        if (fn) {
          const callId = String(fn.id ?? fn.call_id ?? `call_${pending.size}`)
          const call: ToolCall = {
            id: callId,
            name: String(fn.name ?? ''),
            arguments: serializeToolArgs(fn.args ?? fn.arguments)
          }
          pending.set(callId, call)
          yield { type: 'tool_call', toolCall: call }
        }
      }
    }

    if (eventType === 'step.start') {
      const step = event.step as Record<string, unknown> | undefined
      if (step?.type === 'thought') thoughtSteps.push(step)
    }

    if (eventType === 'interaction.completed') {
      const usage = interaction?.usage as Record<string, unknown> | undefined
      if (usage) {
        lastUsage = {
          inputTokens:
            typeof usage.total_input_tokens === 'number' ? usage.total_input_tokens : undefined,
          outputTokens:
            typeof usage.total_output_tokens === 'number' ? usage.total_output_tokens : undefined,
          totalTokens:
            typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
          reasoningTokens:
            typeof usage.total_thought_tokens === 'number' ? usage.total_thought_tokens : undefined
        }
      }
    }
  }

  if (thinkingText) yield { type: 'thinking_done', text: thinkingText }

  const reasoningState: ProviderReasoningState | undefined =
    interactionId || thoughtSteps.length
      ? {
          kind: 'gemini_interactions',
          interactionId,
          thoughtSteps: thoughtSteps.length ? thoughtSteps : undefined
        }
      : undefined

  yield { type: 'done', usage: lastUsage, reasoningState }
}
