import { z } from 'zod'
import type { ChatMessage, ProviderId } from '../ipc'

export const ThinkingEffortSchema = z.enum([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])
export type ThinkingEffort = z.infer<typeof ThinkingEffortSchema>

export const ThinkingApiSchema = z.enum([
  'responses',
  'interactions',
  'messages',
  'chat_completions'
])
export type ThinkingApi = z.infer<typeof ThinkingApiSchema>

export const ThinkingConfigSchema = z.object({
  enabled: z.boolean(),
  effort: ThinkingEffortSchema.optional(),
  maxTokens: z.number().int().positive().optional(),
  display: z.enum(['summarized', 'omitted']).optional()
})
export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>

const AnthropicThinkingBlockSchema = z.object({
  type: z.enum(['thinking', 'redacted_thinking']),
  thinking: z.string().optional(),
  data: z.string().optional()
})

const OpenAiResponsesStateSchema = z.object({
  kind: z.literal('openai_responses'),
  responseId: z.string().optional(),
  outputItems: z.array(z.unknown())
})

const GeminiInteractionsStateSchema = z.object({
  kind: z.literal('gemini_interactions'),
  interactionId: z.string().optional(),
  thoughtSteps: z.array(z.unknown()).optional()
})

const AnthropicReasoningStateSchema = z.object({
  kind: z.literal('anthropic'),
  blocks: z.array(AnthropicThinkingBlockSchema)
})

const OpenAiCompatReasoningStateSchema = z.object({
  kind: z.literal('openai_compat'),
  reasoningContent: z.string().optional(),
  reasoningDetails: z.unknown().optional()
})

export const ProviderReasoningStateSchema = z.discriminatedUnion('kind', [
  OpenAiResponsesStateSchema,
  GeminiInteractionsStateSchema,
  AnthropicReasoningStateSchema,
  OpenAiCompatReasoningStateSchema
])
export type ProviderReasoningState = z.infer<typeof ProviderReasoningStateSchema>

export type AnthropicThinkingBlock = z.infer<typeof AnthropicThinkingBlockSchema>

export { normalizeModelIdForHeuristics } from './serviceTier'

/** Heuristic: whether a model id likely supports extended thinking. */
export function modelSupportsThinking(id: string, providerId?: ProviderId): boolean {
  const lower = id.toLowerCase()
  const core = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1).toLowerCase() : lower
  if (/^o[34](-|$)|^gpt-5|^gpt-5\.|^gpt-4\.1-mini.*high/i.test(core)) return true
  if (/claude-(opus|sonnet|haiku|fable|mythos)/i.test(core)) return true
  if (/gemini-(2\.5|3(\.\d+)?|3-pro|3\.5)/i.test(core)) return true
  if (/deepseek-v4|^deepseek-reasoner/i.test(core)) return true
  if (/grok-[34]/i.test(core)) return true
  if (providerId === 'openrouter' && /thinking|reason/i.test(lower)) return true
  if (providerId === 'ollama' && /(r1|reason|think|qwq)/i.test(core)) return true
  return false
}

/** Map provider + model to the official thinking API surface. */
export function thinkingApiFor(id: string, providerId: ProviderId): ThinkingApi | undefined {
  if (!modelSupportsThinking(id, providerId)) return undefined
  switch (providerId) {
    case 'openai':
      return 'responses'
    case 'gemini':
      return 'interactions'
    case 'anthropic':
      return 'messages'
    case 'deepseek':
    case 'openrouter':
    case 'groq':
    case 'xai':
    case 'mistral':
    case 'ollama':
    case 'custom':
      return 'chat_completions'
    default:
      return undefined
  }
}

/** Anthropic adaptive thinking is available on Opus 4.7+ / Opus 5+ / Sonnet 5+ / Fable 5+. */
export function anthropicUsesAdaptiveThinking(modelId: string): boolean {
  return /claude-(opus-4-[78]|opus-4\.[78]|opus-5|sonnet-5|fable-5|mythos)/i.test(modelId)
}

/** Anthropic manual budget_tokens mode for older Claude 4.x models. */
export function anthropicUsesManualThinking(modelId: string): boolean {
  if (!modelSupportsThinking(modelId, 'anthropic')) return false
  return !anthropicUsesAdaptiveThinking(modelId)
}

export function parseProviderReasoningState(value: unknown): ProviderReasoningState | undefined {
  const parsed = ProviderReasoningStateSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** OpenAI Responses API: supports none, minimal, low, medium, high, xhigh (not max). */
export function normalizeEffortForOpenAiResponses(
  effort?: ThinkingEffort,
  enabled = true
): string {
  if (!enabled) return 'none'
  if (!effort || effort === 'medium') return 'medium'
  if (effort === 'max') return 'xhigh'
  return effort
}

/** Gemini Interactions API: minimal, low, medium, high only. */
export function normalizeEffortForGeminiInteractions(effort?: ThinkingEffort): string {
  switch (effort) {
    case 'minimal':
      return 'minimal'
    case 'low':
      return 'low'
    case 'high':
    case 'xhigh':
    case 'max':
      return 'high'
    default:
      return 'medium'
  }
}

/** Groq / xAI OpenAI-compat chat: none, low, medium, high (Groq also accepts default). */
export function normalizeEffortForOpenAiCompatReasoning(
  effort: ThinkingEffort | undefined,
  providerId: 'groq' | 'xai'
): string {
  const e = effort ?? 'medium'
  if (e === 'minimal') return 'none'
  if (e === 'xhigh' || e === 'max') return 'high'
  if (e === 'low' || e === 'medium' || e === 'high') return e
  return providerId === 'groq' ? 'default' : 'medium'
}

/** Rough token estimate for opaque reasoning replay blobs. */
export function estimateReasoningStateTokens(state: unknown): number {
  if (state == null) return 0
  try {
    const json = JSON.stringify(state)
    return Math.ceil(json.length / 4)
  } catch {
    return 0
  }
}

/** Collect trailing tool results for provider continuation turns. */
export function trailingToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const trailing: ChatMessage[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'tool') break
    trailing.unshift(m)
  }
  return trailing
}
