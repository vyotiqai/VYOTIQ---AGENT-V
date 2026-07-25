import type { ProviderChatRequest } from './types'
import {
  anthropicUsesAdaptiveThinking,
  anthropicUsesManualThinking,
  type AnthropicThinkingBlock
} from '../../../shared/reasoning'

const DEFAULT_MANUAL_BUDGET = 10_000

/** Build Anthropic thinking + effort request fields when enabled. */
export function anthropicThinkingFields(req: ProviderChatRequest): Record<string, unknown> {
  if (!req.thinking?.enabled) return {}

  const model = req.model
  const effort = req.thinking.effort ?? 'medium'
  const display = req.thinking.display ?? 'summarized'

  if (anthropicUsesAdaptiveThinking(model)) {
    return {
      thinking: { type: 'adaptive', display },
      output_config: { effort }
    }
  }

  if (anthropicUsesManualThinking(model)) {
    const budget = req.thinking.maxTokens ?? DEFAULT_MANUAL_BUDGET
    const maxTokens = Math.max(
      defaultAnthropicMaxTokens(model, req.maxOutputTokens),
      budget + 1024
    )
    return {
      thinking: { type: 'enabled', budget_tokens: budget },
      max_tokens: maxTokens
    }
  }

  return {}
}

function defaultAnthropicMaxTokens(model: string, hint?: number): number {
  if (hint && hint > 0) return Math.min(hint, 64_000)
  if (/haiku/i.test(model)) return 8192
  if (/opus|fable/i.test(model)) return 16_384
  return 8192
}

/** Replay stored Anthropic thinking blocks before text/tool_use in assistant messages. */
export function anthropicThinkingBlocksFromMessage(
  reasoningState: unknown
): AnthropicThinkingBlock[] {
  if (!reasoningState || typeof reasoningState !== 'object') return []
  const state = reasoningState as { kind?: string; blocks?: unknown }
  if (state.kind !== 'anthropic' || !Array.isArray(state.blocks)) return []
  return state.blocks as AnthropicThinkingBlock[]
}
