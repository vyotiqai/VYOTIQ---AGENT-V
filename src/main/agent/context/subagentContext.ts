import type { ChatMessage, ModelInfo } from '../../../shared/ipc'
import { contentWindow } from './budget'
import { estimateTextTokens } from './estimate'
import { trimHistoryToBudget } from './historyTrim'
import { trimToolResults } from './toolTrim'

export function estimateSubagentOverheadTokens(
  systemPrompt: string,
  toolsJsonEstimate: number
): number {
  return estimateTextTokens(systemPrompt) + toolsJsonEstimate
}

/** Fit a sub-agent's isolated transcript under its model window before each provider call. */
export function prepareSubagentMessages(
  messages: ChatMessage[],
  model: ModelInfo,
  overheadTokens: number
): ChatMessage[] {
  const historyBudget = Math.max(1000, contentWindow(model) - overheadTokens)
  const pin = messages[0]?.role === 'user' ? messages[0] : null
  let trimmed = trimToolResults(messages)
  trimmed = trimHistoryToBudget(trimmed, historyBudget, model)
  if (pin) {
    const pinStillFirst =
      trimmed[0] === pin ||
      (trimmed[0]?.role === 'user' && trimmed[0].content === pin.content)
    if (!pinStillFirst) {
      const withoutDup = trimmed.filter(
        (m) => !(m.role === 'user' && m.content === pin.content)
      )
      trimmed = [pin, ...withoutDup]
    }
  }
  return trimmed
}
