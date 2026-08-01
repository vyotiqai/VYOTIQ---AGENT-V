import type { ChatMessage, ModelInfo } from '../../../shared/ipc'
import { flattenFileParts } from '../../../shared/ipc'
import type { LlmProvider } from '../providers/types'
import { anthropicNativeOptions } from './anthropicContext'
import { allocateBudget, compactionTriggerTokens, contentWindow } from './budget'
import { compactMessages, preserveRecentMessagesAsync } from './compact'
import {
  blendInputTokens,
  estimateMessagesTokensAsync,
  estimateTextTokens,
  estimateTextTokensAsync
} from './estimate'
import { readMemoryIndexAsync, readMemoryStateAsync } from './memory'
import { trimHistoryToBudgetAsync } from './historyTrim'
import { trimToolResults } from './toolTrim'
import {
  KEEP_RECENT_TURNS,
  isTrimWatermarkCompaction,
  type AssembleInput,
  type AssembleResult,
  type CompactionRecord,
  type ContextLayerBreakdown
} from './types'
import { stripUnsupportedModalitiesFromMessages, wireCapsFromModel } from './stripImages'
import { buildWorkspaceRulesSection } from './rules'
import { buildWorkspaceSnapshotAsync } from './workspaceSnapshot'
import { logger } from '../../../shared/logger'
import { perfLog, perfNow } from './perfDebug'
import { combineLoopHints, loopHintForCompactionFailure } from '../loopPolicy'

const COMPACTION_MIN_MESSAGES = 4
const COMPACTION_MIN_TOKENS = 2000

/** In-process cache for the stable instruction prefix only (not the volatile tail). */
type SystemCacheEntry = { fingerprint: string; stable: string }
let systemPromptCache: SystemCacheEntry | null = null

/** @internal — clear stable system-prefix cache (tests). */
export function clearSystemPromptCache(): void {
  systemPromptCache = null
}

/**
 * Fingerprint of durable instruction layers only. Volatile data (clock, snapshot,
 * memory, loop hints, compaction summary) must not appear here or the cache
 * never hits across steps.
 */
function stableSystemFingerprint(parts: {
  harness: string
  rules: string
  skillsSection: string
  pluginRulesSection: string
  contract: string
  plan: string
  modeSection?: string
  nestedRoleSection?: string
  systemBudget: number
}): string {
  return [
    parts.harness,
    parts.rules,
    parts.skillsSection,
    parts.pluginRulesSection,
    parts.contract,
    parts.plan,
    parts.modeSection ?? '',
    parts.nestedRoleSection ?? '',
    String(parts.systemBudget)
  ].join('\0')
}

function capText(text: string, maxTokens: number): string {
  const maxChars = Math.max(200, maxTokens * 4)
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n…'
}

/**
 * Lower priority = drop first when capping. Core instruction sections kept longest.
 * All core instruction headings are >= 95 so capHarness never discards them.
 */
function harnessSectionPriority(heading: string): number {
  const h = heading.toLowerCase()
  if (h.includes('role')) return 100
  if (h.includes('tool')) return 99
  if (h.includes('constraints')) return 98
  if (h.includes('output format')) return 97
  if (h.includes('capabilities')) return 96
  if (h.includes('work style') || h.includes('workstyle')) return 95
  if (h.includes('memory')) return 50
  if (h.includes('context')) return 40
  return 20
}

/**
 * Cap harness text by dropping lowest-priority ## sections first,
 * then truncating what remains.
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
    if (sections[idx].priority >= 95) continue
    sections[idx].keep = false
    out = joined()
    if (out.length <= maxChars) return out
  }

  return capText(out || text, maxTokens)
}

function buildStableSystem(parts: {
  harness: string
  rules: string
  skillsSection?: string
  pluginRulesSection?: string
  contract?: string
  plan?: string
  modeSection?: string
  nestedRoleSection?: string
  budgets: ReturnType<typeof allocateBudget>
  model: ModelInfo
}): string {
  const fingerprint = stableSystemFingerprint({
    harness: parts.harness,
    rules: parts.rules,
    skillsSection: parts.skillsSection ?? '',
    pluginRulesSection: parts.pluginRulesSection ?? '',
    contract: parts.contract ?? '',
    plan: parts.plan ?? '',
    modeSection: parts.modeSection,
    nestedRoleSection: parts.nestedRoleSection,
    systemBudget: parts.budgets.system
  })
  if (systemPromptCache?.fingerprint === fingerprint) {
    return systemPromptCache.stable
  }

  const sections: string[] = []
  let systemTokensLeft = parts.budgets.system
  function capWithinSystem(
    text: string,
    requested: number,
    capFn: (text: string, maxTokens: number) => string = capText
  ): string | null {
    if (systemTokensLeft < 50) return null
    const allowed = Math.min(requested, systemTokensLeft)
    const capped = capFn(text, allowed)
    const used = estimateTextTokens(capped, parts.model)
    systemTokensLeft -= used
    return capped
  }

  const harness = capWithinSystem(
    parts.harness,
    Math.floor(parts.budgets.system * 0.75),
    capHarness
  )
  if (harness) sections.push(harness)

  // Mode and nested role are high-authority session directives. Mode is placed
  // before the nested role so the more specific subagent role can override mode
  // statements when the two conflict.
  if (parts.modeSection?.trim()) {
    const mode = capWithinSystem(
      parts.modeSection.trim(),
      Math.max(400, Math.floor(parts.budgets.system * 0.35))
    )
    if (mode) sections.push(mode)
  }
  if (parts.nestedRoleSection?.trim()) {
    const nested = capWithinSystem(
      parts.nestedRoleSection.trim(),
      Math.max(300, Math.floor(parts.budgets.system * 0.25))
    )
    if (nested) sections.push(nested)
  }

  // Run directives come before rules/skills so they are not buried.
  if (parts.contract?.trim()) {
    // Strip an existing `# Run contract` or `## Run contract` heading so we
    // don't duplicate the wrapper we prepend.
    const contractBody = parts.contract.trim().replace(/^#+\s*Run contract\s*(?:\r?\n)*/i, '')
    const contract = capWithinSystem(
      `## Run contract\n${contractBody}`,
      Math.floor(parts.budgets.system * 0.4)
    )
    if (contract) sections.push(contract)
  }
  if (parts.plan?.trim()) {
    const planBody = parts.plan.trim().replace(/^#+\s*Plan\s*(?:\r?\n)*/i, '')
    const plan = capWithinSystem(`## Plan\n${planBody}`, Math.floor(parts.budgets.system * 0.4))
    if (plan) sections.push(plan)
  }

  // Workspace conventions and add-on rules (metadata for skills / plugin rules).
  if (parts.skillsSection?.trim()) {
    const skills = capWithinSystem(parts.skillsSection.trim(), Math.floor(parts.budgets.system * 0.35))
    if (skills) sections.push(skills)
  }
  if (parts.pluginRulesSection?.trim()) {
    const plugins = capWithinSystem(parts.pluginRulesSection.trim(), Math.floor(parts.budgets.system * 0.25))
    if (plugins) sections.push(plugins)
  }
  if (parts.rules.trim()) {
    const rules = capWithinSystem(parts.rules.trim(), Math.floor(parts.budgets.system * 0.5))
    if (rules) sections.push(rules)
  }

  const stable = sections.join('\n\n')
  systemPromptCache = { fingerprint, stable }
  return stable
}

/** Per-step data layers: clock, snapshot, notices, memory, compaction summary. */
function buildVolatileSystem(parts: {
  workspace: string
  memoryIndex: string
  memoryState: string
  sessionEnv?: string
  compaction?: CompactionRecord | null
  budgets: ReturnType<typeof allocateBudget>
  loopHint?: string
}): string {
  const sections: string[] = []
  const mw = Math.floor(parts.budgets.memoryWorkspace / 3)
  const envCap = Math.max(200, Math.floor(parts.budgets.system * 0.15))

  // Session env and workspace snapshot are data, not instructions.
  if (parts.sessionEnv?.trim()) {
    sections.push(capText(parts.sessionEnv.trim(), envCap))
  }
  if (parts.workspace.trim()) {
    sections.push(capText(parts.workspace, mw))
  }
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
        // Summaries accumulate across compact, so this needs a cap like every
        // other section or it can crowd out the harness it sits beside.
        capText(parts.compaction.summary, mw)
      ].join('\n')
    )
  }
  return sections.join('\n\n')
}

/**
 * Two-zone system string: stable instruction prefix + volatile data tail.
 * Providers still receive a single `system` channel.
 */
function buildSystem(parts: {
  harness: string
  workspace: string
  rules: string
  skillsSection?: string
  pluginRulesSection?: string
  memoryIndex: string
  memoryState: string
  contract?: string
  plan?: string
  modeSection?: string
  sessionEnv?: string
  nestedRoleSection?: string
  compaction?: CompactionRecord | null
  budgets: ReturnType<typeof allocateBudget>
  loopHint?: string
  model: ModelInfo
}): string {
  const stable = buildStableSystem({
    harness: parts.harness,
    rules: parts.rules,
    skillsSection: parts.skillsSection,
    pluginRulesSection: parts.pluginRulesSection,
    contract: parts.contract,
    plan: parts.plan,
    modeSection: parts.modeSection,
    nestedRoleSection: parts.nestedRoleSection,
    budgets: parts.budgets,
    model: parts.model
  })
  const volatile = buildVolatileSystem({
    workspace: parts.workspace,
    memoryIndex: parts.memoryIndex,
    memoryState: parts.memoryState,
    sessionEnv: parts.sessionEnv,
    compaction: parts.compaction,
    budgets: parts.budgets,
    loopHint: parts.loopHint
  })
  if (!volatile) return stable
  if (!stable) return volatile
  return `${stable}\n\n${volatile}`
}

async function computeLayers(
  system: string,
  messages: ChatMessage[],
  toolsJsonEstimate: number,
  model: ModelInfo,
  budgets: ReturnType<typeof allocateBudget>
): Promise<ContextLayerBreakdown> {
  const [systemTokens, history] = await Promise.all([
    estimateTextTokensAsync(system, model),
    estimateMessagesTokensAsync(messages, model)
  ])
  return {
    system: systemTokens,
    history,
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

async function shouldCompactHistory(
  toSummarize: ChatMessage[],
  model: ModelInfo
): Promise<boolean> {
  if (toSummarize.length > COMPACTION_MIN_MESSAGES) return true
  return (await estimateMessagesTokensAsync(toSummarize, model)) >= COMPACTION_MIN_TOKENS
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

  // Text attachments flatten to text; audio/native files stay until caps apply.
  let messages = trimToolResults(
    input.messages.map((message) =>
      typeof message.content === 'string'
        ? message
        : { ...message, content: flattenFileParts(message.content) }
    )
  )
  messages = stripUnsupportedModalitiesFromMessages(messages, wireCapsFromModel(input.model))
  let compaction = input.priorCompaction ?? null
  let contextShrunk = false

  const estimateStarted = perfNow()
  const systemParts = {
    harness: input.harness,
    workspace,
    rules,
    skillsSection: input.skillsSection,
    pluginRulesSection: input.pluginRulesSection,
    memoryIndex,
    memoryState,
    contract: input.contract,
    plan: input.plan,
    modeSection: input.modeSection,
    sessionEnv: input.sessionEnv,
    nestedRoleSection: input.nestedRoleSection,
    budgets,
    loopHint: input.loopHint,
    model: input.model
  }

  const systemDraft = buildSystem({
    ...systemParts,
    compaction
  })

  let layers = await computeLayers(systemDraft, messages, input.toolsJsonEstimate, input.model, budgets)
  let estimated = totalFromLayers(layers)
  perfLog('estimateMessagesTokens', estimateStarted, {
    messages: messages.length,
    estimated
  })

  const trigger = compactionTriggerTokens(input.model, triggerRatio)
  let used = resolveUsedTokens(estimated, input.lastUsage, trigger)

  if (used >= trigger || estimated >= trigger) {
    const keptForBoundary = await preserveRecentMessagesAsync(
      messages,
      keepRecent,
      budgets.history,
      input.model
    )
    const toSummarize = messages.slice(0, Math.max(0, messages.length - keptForBoundary.length))
    if (await shouldCompactHistory(toSummarize, input.model)) {
      const record = await compactMessages({
        provider: input.provider,
        model: input.model.id,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        signal: input.signal,
        messages: stripThinkingForCompaction(toSummarize),
        supportsStructuredOutput: input.model.supportsStructuredOutput,
        contextWindow: window,
        priorSummary: isTrimWatermarkCompaction(compaction) ? undefined : compaction?.summary
      })
      if (record) {
        messages = keptForBoundary
        compaction = record
        contextShrunk = true
      } else {
        // Summarize failed — keep recent turns and shrink so the next step does
        // not re-invoke the same compaction LLM call. The loop persists a trim
        // watermark from contextShrunk + dropped count.
        messages = keptForBoundary
        contextShrunk = true
        systemParts.loopHint = combineLoopHints(
          systemParts.loopHint,
          loopHintForCompactionFailure()
        )
      }
    }
  }

  messages = await trimHistoryToBudgetAsync(messages, budgets.history, input.model)

  let system = buildSystem({
    ...systemParts,
    compaction
  })

  layers = await computeLayers(system, messages, input.toolsJsonEstimate, input.model, budgets)
  estimated = totalFromLayers(layers)
  used = contextShrunk ? estimated : resolveUsedTokens(estimated, input.lastUsage, trigger)

  if (estimated > window) {
    const priorLen = messages.length
    messages = await trimHistoryToBudgetAsync(messages, Math.floor(budgets.history * 0.5), input.model)
    if (messages.length < priorLen) contextShrunk = true
    system = buildSystem({
      ...systemParts,
      compaction
    })
    layers = await computeLayers(system, messages, input.toolsJsonEstimate, input.model, budgets)
    estimated = totalFromLayers(layers)

    if (estimated > window) {
      const keptForOverflow = await preserveRecentMessagesAsync(
        messages,
        Math.max(2, keepRecent),
        budgets.history,
        input.model
      )
      const toSummarize = messages.slice(0, Math.max(0, messages.length - keptForOverflow.length))
      if (await shouldCompactHistory(toSummarize, input.model)) {
        const record = await compactMessages({
          provider: input.provider,
          model: input.model.id,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          signal: input.signal,
          messages: stripThinkingForCompaction(toSummarize),
          supportsStructuredOutput: input.model.supportsStructuredOutput,
          contextWindow: window,
          priorSummary: isTrimWatermarkCompaction(compaction) ? undefined : compaction?.summary
        })
        if (record) {
          messages = await preserveRecentMessagesAsync(
            messages,
            Math.max(2, Math.floor(keepRecent / 2)),
            budgets.history,
            input.model
          )
          compaction = record
          contextShrunk = true
          system = buildSystem({
            ...systemParts,
            compaction
          })
          layers = await computeLayers(system, messages, input.toolsJsonEstimate, input.model, budgets)
          estimated = totalFromLayers(layers)
        }
      }
    }

    if (estimated > window) {
      // Last-resort shrink before declaring overflow: drop thinking from the
      // wire set, keep only the latest tool result, and stub oversized subagent bodies.
      messages = stripThinkingForCompaction(messages)
      messages = trimToolResults(messages, 1, { trimSubagent: true })
      contextShrunk = true
      system = buildSystem({
        ...systemParts,
        compaction
      })
      layers = await computeLayers(system, messages, input.toolsJsonEstimate, input.model, budgets)
      estimated = totalFromLayers(layers)
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
