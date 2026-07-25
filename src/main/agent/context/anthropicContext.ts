import type { ModelInfo, ProviderId } from '../../../shared/ipc'
import { COMPACTION_TRIGGER_RATIO, KEEP_LAST_TOOL_RESULTS } from './types'
import { contentWindow } from './budget'
const ANTHROPIC_COMPACT_MIN_TRIGGER = 8_000

export function anthropicNativeOptions(
  providerId: ProviderId,
  model: ModelInfo | number,
  triggerRatio = COMPACTION_TRIGGER_RATIO
): {
  enableContextManagement: boolean
  clearToolUsesKeep: number
  compactTriggerTokens: number
} {
  const enable = providerId === 'anthropic'
  const window = typeof model === 'number' ? model : contentWindow(model)
  const raw = Math.floor(window * triggerRatio)
  return {
    enableContextManagement: enable,
    clearToolUsesKeep: KEEP_LAST_TOOL_RESULTS,
    compactTriggerTokens: Math.max(ANTHROPIC_COMPACT_MIN_TRIGGER, raw)
  }
}
