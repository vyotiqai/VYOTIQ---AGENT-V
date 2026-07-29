import type { ChatMessage, ModelInfo } from '../../../shared/ipc'
import { flattenFileParts } from '../../../shared/ipc'
import type { LlmProvider } from '../providers/types'
import { anthropicNativeOptions } from './anthropicContext'
import { allocateBudget, compactionTriggerTokens, contentWindow } from './budget'
import { compactMessages, preserveRecentMessages } from './compact'
import {
  blendInputTokens,
  effectiveInputTokens,
  estimateMessagesTokens,
  estimateTextTokens
} from './estimate'
import { readMemoryIndexAsync, readMemoryStateAsync } from './memory'
import { trimHistoryToBudget } from './historyTrim'
import { trimToolResults } from './toolTrim'
import {
  KEEP_RECENT_TURNS,
  isTrimWatermarkCompaction,
  type AssembleInput,
  type AssembleResult,
  type CompactionRecord,
  type ContextLayerBreakdown
} from './types'
import { stripImagesFromMessages } from './stripImages'
import { buildWorkspaceRulesSection } from './rules'
import { buildWorkspaceSnapshotAsync } from './workspaceSnapshot'
import { logger } from '../../../shared/logger'
import { perfLog, perfNow } from './perfDebug'

const COMPACTION_MIN_MESSAGES = 4
const COMPACTION_MIN_TOKENS = 2000

type SystemCacheEntry = { fingerprint: string; system: string }
let systemPromptCache: SystemCacheEntry | null = null

function systemFingerprint(parts: {
  harness: string
  workspace: string
  rules: string
  skillsSection: string
  pluginRulesSection: string
  memoryIndex: string
  memoryState: string
  contract: string
  modeSection?: string
  compactionSummary?: string
  loopHint?: string
  historyBudget: number
  toolsBudget: number
}): string {
  return [
    parts.harness,
    parts.workspace,
    parts.rules,
    parts.skillsSection,
    parts.pluginRulesSection,
    parts.memoryIndex,
    parts.memoryState,
    parts.contract,
    parts.modeSection ?? '',
    parts.compactionSummary ?? '',
    parts.loopHint ?? '',
    String(parts.historyBudget),
    String(parts.toolsBudget)
  ].join('\0')
}

function modelAcceptsVision(model: AssembleInput['model']): boolean {
  return model.supportsVision || model.inputModalities.includes('image')
}

function capText(text: string, maxTokens: number): string {
  const maxChars = Math.max(200, maxTokens * 4)
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n…'
}

/** Lower priority = drop first when capping. Execution contract is kept longest. */
function harnessSectionPriority(heading: string): number {
  const h = heading.toLowerCase()
  if (h.includes('execution contract')) return 100
  // Safety outranks Role — under budget pressure keep constraints over identity.
  if (h.includes('safety')) return 85
  if (h === 'role' || h.endsWith(' role')) return 80
  // Cross-cutting tool policy (MCP / attachments / don't narrate) outranks loop.
  if (h.includes('tool policy') || h.includes('tool')) return 55
  if (h.includes('loop')) return 50
  if (h.includes('memory')) return 40
  return 20
}

/**
 * Cap harness text while preferring to keep Execution contract (+ Role/Safety) intact.
 * Drops lowest-priority ## sections first; only then truncates remaining text.
 */
function capHarness(text: string, maxTokens: number): string {
  const maxChars = Math.max(200, maxTokens * 4)
  if (text.length <= maxChars) return text

  const chunks = text.split(/(?=^##\s+)/m).map((c) => c.trimEnd()).filter(Boolean)
  if (chunks.length <= 1) return capText(text, maxTokens)

  type Sec = { text: string; priority: number; keep: boolean }
  const sections: Sec[] = chunks.map((chunk) => {
    const m = /^##\s+(.+)$/m.exec(chunk)
    const priority = m ? harnessSectionPriority(m[1].trim()) : 95
    return { text: chunk, priority, keep: true }
  })

  const joined = (): string =>
    sections
      .filter((s) => s.keep)
      .map((s) => s.text)
      .join('\n\n')
      .trimEnd()

  let out = joined()
  if (out.length <= maxChars) return out

  const dropOrder = [...sections.keys()].sort(
    (a, b) => sections[a].priority - sections[b].priority
  )
  for (const idx of dropOrder) {
    if (sections[idx].priority >= 100) continue
    sections[idx].keep = false
    out = joined()
    if (out.length <= maxChars) return out
  }

  return capText(out || text, maxTokens)
}

function buildSystem(parts: {
  harness: string
  workspace: string
  rules: string
  skillsSection?: string
  pluginRulesSection?: string
  memoryIndex: string
  memoryState: string
  contract?: string
  modeSection?: string
  compaction?: CompactionRecord | null
  budgets: ReturnType<typeof allocateBudget>
  loopHint?: string
}): string {
  const fingerprint = systemFingerprint({
    harness: parts.harness,
    workspace: parts.workspace,
    rules: parts.rules,
    skillsSection: parts.skillsSection ?? '',
    pluginRulesSection: parts.pluginRulesSection ?? '',
    memoryIndex: parts.memoryIndex,
    memoryState: parts.memoryState,
    contract: parts.contract ?? '',
    modeSection: parts.modeSection,
    compactionSummary:
      parts.compaction?.summary && !isTrimWatermarkCompaction(parts.compaction)
        ? parts.compaction.summary
        : undefined,
    loopHint: parts.loopHint,
    historyBudget: parts.budgets.history,
    toolsBudget: parts.budgets.tools
  })
  if (systemPromptCache?.fingerprint === fingerprint) {
    return systemPromptCache.system
  }

  const sections: string[] = []
  sections.push(capHarness(parts.harness, parts.budgets.system))
  if (parts.modeSection?.trim()) {
    sections.push(capText(parts.modeSection.trim(), Math.floor(parts.budgets.system * 0.2)))
  }
  if (parts.skillsSection?.trim()) {
    sections.push(
      capText(parts.skillsSection.trim(), Math.floor(parts.budgets.system * 0.35))
    )
  }
  if (parts.pluginRulesSection?.trim()) {
    sections.push(
      capText(parts.pluginRulesSection.trim(), Math.floor(parts.budgets.system * 0.25))
    )
  }
  if (parts.rules.trim()) {
    // Between the harness and the run contract: project conventions outrank the
    // generic harness but yield to what the user asked for in this run.
    sections.push(capText(parts.rules.trim(), Math.floor(parts.budgets.system * 0.5)))
  }
  if (parts.contract?.trim()) {
    sections.push(`## Run contract\n${capText(parts.contract.trim(), Math.floor(parts.budgets.system * 0.4))}`)
  }
  const mw = Math.floor(parts.budgets.memoryWorkspace / 3)
  sections.push(capText(parts.workspace, mw))
  if (parts.loopHint?.trim()) {
    sections.push(`## Run notice\n${capText(parts.loopHint.trim(), Math.floor(mw * 0.5))}`)
  }
  if (parts.memoryIndex.trim()) {
    sections.push(`## Memory index\n${capText(parts.memoryIndex, mw)}`)
  }
  if (parts.memoryState.trim()) {
    sections.push(`## Memory state\n${capText(parts.memoryState, mw)}`)
  }
  if (parts.compaction?.summary && !isTrimWatermarkCompaction(parts.compaction)) {
    sections.push(
      [
        '## Prior session summary',
        // Summaries accumulate across compactions, so this needs a cap like every
        // other section or it can crowd out the harness it sits beside.
        capText(parts.compaction.summary, mw),
        '',
        '_Context was compacted. Promote durable facts into `.vyotiq/memory/` (`index.md` / `state.md` / `notes/`) via memory_write — chat history may be truncated._'
      ].join('\n')
    )
  }
  const system = sections.join('\n\n')
  systemPromptCache = { fingerprint, system }
  return system
}

function computeLayers(
  system: string,
  messages: ChatMessage[],
  toolsJsonEstimate: number,
  model: ModelInfo,
  budgets: ReturnType<typeof allocateBudget>
): ContextLayerBreakdown {
  return {
    system: estimateTextTokens(system, model),
    history: estimateMessagesTokens(messages, model),
    tools: toolsJsonEstimate,
    buffer: budgets.buffer
  }
}

function totalFromLayers(layers: ContextLayerBreakdown): number {
  return layers.system + layers.history + layers.tools
}

function stripThinkingForCompaction(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (!m.thinking) return m
    const { thinking: _thinking, ...rest } = m
    return rest
  })
}

function shouldCompactHistory(
  toSummarize: ChatMessage[],
  model: ModelInfo
): boolean {
  if (toSummarize.length > COMPACTION_MIN_MESSAGES) return true
  return estimateMessagesTokens(toSummarize, model) >= COMPACTION_MIN_TOKENS
}

function resolveUsedTokens(
  estimated: number,
  lastUsage: AssembleInput['lastUsage'],
  trigger: number
): number {
  const providerHint = lastUsage?.inputTokens
  // Prefer local estimate only when the provider hint looks inflated *and*
  // is still below the compaction trigger. If the provider already reports
  // at/over trigger, trust it so we do not defer compaction.
  if (
    providerHint !== undefined &&
    providerHint > estimated &&
    estimated < trigger * 0.5 &&
    providerHint < trigger
  ) {
    return estimated
  }
  return blendInputTokens(estimated, lastUsage)
}

export async function assembleContext(
  input: AssembleInput & {
    providerId: import('../../../shared/ipc').ProviderId
    provider: LlmProvider
    apiKey?: string | null
    baseUrl?: string
    signal: AbortSignal
  }
): Promise<AssembleResult> {
  const assembleStarted = perfNow()
  const budgets = allocateBudget(input.model)
  const keepRecent = input.keepRecentTurns ?? KEEP_RECENT_TURNS
  const triggerRatio = input.compactionTriggerRatio ?? 0.7
  const window = contentWindow(input.model)

  const [workspace, rules] = await Promise.all([
    buildWorkspaceSnapshotAsync(input.workspacePath, input.goal),
    buildWorkspaceRulesSection(input.workspacePath)
  ])
  const [memoryIndex, memoryState] = input.workspacePath
    ? await Promise.all([
        readMemoryIndexAsync(input.workspacePath),
        readMemoryStateAsync(input.workspacePath)
      ])
    : ['', '']

  // Attachments stay their own part in the transcript, but no provider knows
  // that shape — inline them as text before anything measures or sends them.
  let messages = trimToolResults(
    input.messages.map((message) =>
      typeof message.content === 'string'
        ? message
        : { ...message, content: flattenFileParts(message.content) }
    )
  )
  if (!modelAcceptsVision(input.model)) {
    messages = stripImagesFromMessages(messages)
  }
  let compaction = input.priorCompaction ?? null
  let contextShrunk = false

  const estimateStarted = perfNow()
  const systemDraft = buildSystem({
    harness: input.harness,
    workspace,
    rules,
    skillsSection: input.skillsSection,
    pluginRulesSection: input.pluginRulesSection,
    memoryIndex,
    memoryState,
    contract: input.contract,
    modeSection: input.modeSection,
    compaction,
    budgets,
    loopHint: input.loopHint
  })

  let layers = computeLayers(systemDraft, messages, input.toolsJsonEstimate, input.model, budgets)
  let estimated = totalFromLayers(layers)
  perfLog('estimateMessagesTokens', estimateStarted, {
    messages: messages.length,
    estimated
  })

  const trigger = compactionTriggerTokens(input.model, triggerRatio)
  let used = resolveUsedTokens(estimated, input.lastUsage, trigger)

  if (used >= trigger || estimated >= trigger) {
    const keptForBoundary = preserveRecentMessages(
      messages,
      keepRecent,
      budgets.history,
      input.model
    )
    const toSummarize = messages.slice(0, Math.max(0, messages.length - keptForBoundary.length))
    if (shouldCompactHistory(toSummarize, input.model)) {
      const record = await compactMessages({
        provider: input.provider,
        model: input.model.id,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        signal: input.signal,
        messages: stripThinkingForCompaction(toSummarize),
        supportsStructuredOutput: input.model.supportsStructuredOutput,
        contextWindow: window,
        priorSummary: isTrimWatermarkCompaction(input.priorCompaction)
          ? undefined
          : input.priorCompaction?.summary
      })
      if (record) {
        messages = keptForBoundary
        compaction = record
        contextShrunk = true
      }
    }
  }

  messages = trimHistoryToBudget(messages, budgets.history, input.model)

  let system = buildSystem({
    harness: input.harness,
    workspace,
    rules,
    skillsSection: input.skillsSection,
    pluginRulesSection: input.pluginRulesSection,
    memoryIndex,
    memoryState,
    contract: input.contract,
    compaction,
    budgets,
    loopHint: input.loopHint
  })

  layers = computeLayers(system, messages, input.toolsJsonEstimate, input.model, budgets)
  estimated = totalFromLayers(layers)
  used = contextShrunk ? estimated : resolveUsedTokens(estimated, input.lastUsage, trigger)

  if (estimated > window) {
    const priorLen = messages.length
    messages = trimHistoryToBudget(messages, Math.floor(budgets.history * 0.5), input.model)
    if (messages.length < priorLen) contextShrunk = true
    system = buildSystem({
      harness: input.harness,
      workspace,
      rules,
      skillsSection: input.skillsSection,
      pluginRulesSection: input.pluginRulesSection,
      memoryIndex,
      memoryState,
      contract: input.contract,
      compaction,
      budgets,
      loopHint: input.loopHint
    })
    layers = computeLayers(system, messages, input.toolsJsonEstimate, input.model, budgets)
    estimated = totalFromLayers(layers)

    if (estimated > window) {
      const toSummarize = messages.slice(0, Math.max(0, messages.length - Math.max(2, keepRecent)))
      if (shouldCompactHistory(toSummarize, input.model)) {
        const record = await compactMessages({
          provider: input.provider,
          model: input.model.id,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          signal: input.signal,
          messages: stripThinkingForCompaction(toSummarize),
          supportsStructuredOutput: input.model.supportsStructuredOutput,
          contextWindow: window,
          priorSummary: isTrimWatermarkCompaction(compaction)
            ? undefined
            : (compaction?.summary ??
              (isTrimWatermarkCompaction(input.priorCompaction)
                ? undefined
                : input.priorCompaction?.summary))
        })
        if (record) {
          messages = preserveRecentMessages(messages, Math.max(2, Math.floor(keepRecent / 2)), budgets.history, input.model)
          compaction = record
          contextShrunk = true
          system = buildSystem({
            harness: input.harness,
            workspace,
            rules,
            skillsSection: input.skillsSection,
            pluginRulesSection: input.pluginRulesSection,
            memoryIndex,
            memoryState,
            contract: input.contract,
            compaction,
            budgets,
            loopHint: input.loopHint
          })
          layers = computeLayers(system, messages, input.toolsJsonEstimate, input.model, budgets)
          estimated = totalFromLayers(layers)
        }
      }
    }

    if (estimated > window) {
      logger.warn('Context still exceeds model window after compaction', {
        scope: 'agent',
        code: 'CONTEXT_OVERFLOW',
        estimated,
        window
      })
    }
  }

  perfLog('assembleContext', assembleStarted, {
    messages: messages.length,
    estimated,
    contextShrunk
  })

  return {
    system,
    messages,
    compaction,
    estimatedTokens: estimated,
    layers,
    contextShrunk,
    overflow: estimated > window,
    anthropicNative: anthropicNativeOptions(
      input.providerId,
      input.model,
      triggerRatio
    )
  }
}

/** Estimate tool definitions JSON size in tokens. */
export function estimateToolsJson(tools: unknown[]): number {
  try {
    return estimateTextTokens(JSON.stringify(tools))
  } catch {
    return 500
  }
}

export type { AssembleResult, CompactionRecord, ChatMessage }
