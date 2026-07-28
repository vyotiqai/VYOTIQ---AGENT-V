import type { ChatMessage, ModelInfo } from '../../../shared/ipc'
import type { TokenUsage } from '../providers/types'
import {
  BUDGET_SHARES as SHARED_BUDGET_SHARES,
  DEFAULT_CONTEXT_WINDOW as SHARED_DEFAULT_CONTEXT_WINDOW
} from '../../../shared/domain/contextBudget'

export type BudgetLayers = {
  system: number
  tools: number
  memoryWorkspace: number
  history: number
  buffer: number
}

/** Fixed budget shares of model context window — kept in sync via shared/domain/contextBudget. */
export const BUDGET_SHARES: BudgetLayers = SHARED_BUDGET_SHARES

export const COMPACTION_TRIGGER_RATIO = 0.7
export const KEEP_RECENT_TURNS = 12
export const KEEP_LAST_TOOL_RESULTS = 3
export const MEMORY_INDEX_CAP = 3000
export const MEMORY_STATE_CAP = 3000
export const DEFAULT_CONTEXT_WINDOW = SHARED_DEFAULT_CONTEXT_WINDOW

import { z } from 'zod'

export const CompactionRecordSchema = z.object({
  summary: z.string().min(1),
  createdAt: z.string(),
  tokenEstimate: z.number().int().min(0),
  /**
   * Count of leading messages in `messages.jsonl` that this summary already
   * represents. The loop skips them when rebuilding its working set, so a long
   * run stops re-summarizing the same prefix on every step. Older records
   * predate the field, so it stays optional.
   */
  foldedMessages: z.number().int().min(0).optional()
})
export type CompactionRecord = z.infer<typeof CompactionRecordSchema>

/**
 * Sentinel summary for trim-only watermarks. Persists `foldedMessages` across
 * resume when history was dropped without an LLM summary. Never inject into
 * the system prompt or promote to memory.
 */
export const CONTEXT_TRIM_WATERMARK_SUMMARY = '__vyotiq_context_trim_watermark__'

export function isTrimWatermarkCompaction(
  record: Pick<CompactionRecord, 'summary'> | null | undefined
): boolean {
  return record?.summary === CONTEXT_TRIM_WATERMARK_SUMMARY
}

export type AssembleInput = {
  harness: string
  messages: ChatMessage[]
  workspacePath: string | null
  goal: string
  model: ModelInfo
  toolsJsonEstimate: number
  lastUsage?: TokenUsage
  keepRecentTurns?: number
  compactionTriggerRatio?: number
  contract?: string
  priorCompaction?: CompactionRecord | null
  /** Injected when the agent loop detects repeated tool-failure steps (generic, not workspace-specific). */
  loopHint?: string
  /** Eager marketplace skills section (pre-built markdown). */
  skillsSection?: string
  /** Enabled plugin rules section (pre-built markdown). */
  pluginRulesSection?: string
}

export type ContextLayerBreakdown = {
  system: number
  history: number
  tools: number
  buffer: number
}

export type AssembleResult = {
  system: string
  messages: ChatMessage[]
  compaction?: CompactionRecord | null
  estimatedTokens: number
  layers: ContextLayerBreakdown
  contextShrunk: boolean
  /** True when estimated tokens still exceed the content window after compaction/trim. */
  overflow: boolean
  anthropicNative: {
    enableContextManagement: boolean
    clearToolUsesKeep: number
    compactTriggerTokens: number
  }
}
