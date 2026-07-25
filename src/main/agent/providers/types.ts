import type { ChatMessage, ModelInfo, ProviderId } from '../../../shared/ipc'
import type { ProviderReasoningState, ThinkingConfig } from '../../../shared/reasoning'
import type { ServiceTier } from '../../../shared/ipc/schemas/providers'

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  /** Input tokens served from provider prompt cache (OpenAI, DeepSeek, Groq, Anthropic, Gemini). */
  cachedInputTokens?: number
  /** Reasoning / thinking tokens billed as output (provider-specific). */
  reasoningTokens?: number
}

export interface StreamChunk {
  type:
    | 'text'
    | 'thinking_delta'
    | 'thinking_done'
    | 'tool_call_delta'
    | 'tool_call'
    | 'done'
    | 'error'
  text?: string
  toolCall?: ToolCall
  toolCallDelta?: { index: number; id?: string; name?: string; arguments?: string }
  error?: string
  usage?: TokenUsage
  /** Anthropic server-side compaction summary (not user-visible assistant text). */
  compaction?: string
  /** Provider reasoning replay state captured during the stream. */
  reasoningState?: ProviderReasoningState
}

export interface ListModelsRequest {
  apiKey?: string | null
  baseUrl?: string
  signal?: AbortSignal
}

export interface ResponseFormat {
  type: 'json_schema'
  name: string
  schema: Record<string, unknown>
  strict?: boolean
}

export interface ProviderChatRequest {
  model: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  system?: string
  signal: AbortSignal
  apiKey?: string | null
  baseUrl?: string
  /** Optional max output tokens from model metadata. */
  maxOutputTokens?: number
  /** Anthropic-native context management / caching. */
  anthropicNative?: {
    enableContextManagement: boolean
    clearToolUsesKeep: number
    compactTriggerTokens?: number
  }
  responseFormat?: ResponseFormat
  toolChoice?: 'auto' | 'none' | 'required'
  parallelToolCalls?: boolean
  /** When tools are present, default true. */
  strictTools?: boolean
  /** OpenAI prompt-cache routing key (stable per run). */
  promptCacheKey?: string
  /** Extended thinking configuration from user settings. */
  thinking?: ThinkingConfig
  /** Prior-step reasoning replay state for multi-turn tool loops. */
  reasoningState?: ProviderReasoningState
  /** Resolved model metadata for routing (Responses vs Completions, etc.). */
  modelInfo?: ModelInfo
  /** API service tier (flex / priority) when supported. */
  serviceTier?: ServiceTier
}

export interface LlmProvider {
  id: ProviderId
  streamChat(req: ProviderChatRequest): AsyncGenerator<StreamChunk>
  listModels(req: ListModelsRequest): Promise<ModelInfo[]>
}
