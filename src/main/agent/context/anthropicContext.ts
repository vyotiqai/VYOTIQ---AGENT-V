import type { ModelInfo, ProviderId } from '../../../shared/ipc'
import { COMPACTION_TRIGGER_RATIO, KEEP_LAST_TOOL_RESULTS } from './types'
import { contentWindow } from './budget'
const ANTHROPIC_COMPACT_MIN_TRIGGER = 8_000
/** Floor for clear_tool_uses trigger — avoid clearing every short turn (cache thrash). */
const ANTHROPIC_CLEAR_TOOL_USES_MIN_TRIGGER = 32_000
/**
 * Minimum tokens cleared per clear_tool_uses activation so a cache rewrite is worth it
 * (Anthropic context-editing docs: use clear_at_least).
 */
const ANTHROPIC_CLEAR_TOOL_USES_AT_LEAST = 5_000
/** clear_tool_uses fires earlier than server compact; ~35% of window. */
const ANTHROPIC_CLEAR_TOOL_USES_RATIO = 0.35

/**
 * Tool results the server must not clear — durable state / user answers / file bodies
 * the agent often re-references (AppData: heavy `read` + `memory_*` use).
 * Large search/terminal/MCP bodies remain eligible for clearing.
 */
export const ANTHROPIC_CLEAR_TOOL_USES_EXCLUDE = [
  'read',
  'memory_read',
  'memory_list',
  'memory_write',
  'todo_write',
  'ask_question'
] as const

export function anthropicNativeOptions(
  providerId: ProviderId,
  model: ModelInfo | number,
  triggerRatio = COMPACTION_TRIGGER_RATIO
): {
  enableContextManagement: boolean
  clearToolUsesKeep: number
  compactTriggerTokens: number
  clearToolUsesTriggerTokens: number
  clearToolUsesAtLeastTokens: number
  clearToolUsesExcludeTools: string[]
} {
  const enable = providerId === 'anthropic'
  const window = typeof model === 'number' ? model : contentWindow(model)
  const raw = Math.floor(window * triggerRatio)
  const clearTrigger = Math.floor(window * ANTHROPIC_CLEAR_TOOL_USES_RATIO)
  return {
    enableContextManagement: enable,
    clearToolUsesKeep: KEEP_LAST_TOOL_RESULTS,
    compactTriggerTokens: Math.max(ANTHROPIC_COMPACT_MIN_TRIGGER, raw),
    clearToolUsesTriggerTokens: Math.max(ANTHROPIC_CLEAR_TOOL_USES_MIN_TRIGGER, clearTrigger),
    clearToolUsesAtLeastTokens: ANTHROPIC_CLEAR_TOOL_USES_AT_LEAST,
    clearToolUsesExcludeTools: [...ANTHROPIC_CLEAR_TOOL_USES_EXCLUDE]
  }
}
