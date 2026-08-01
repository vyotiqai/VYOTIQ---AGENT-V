/**
 * Nested agent loop — same runtime primitives as `runAgent` (harness,
 * assembleContext, MCP catalog, executeStepToolCalls, thinking, approvals),
 * with isolation differences only (own transcript dir, depth-1 tool exclusions,
 * no runRegistry slot, abort linked via caller signal).
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import type {
  AgentEvent,
  AgentInteractionMode,
  ChatMessage,
  ProviderId
} from '../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../shared/ipc'
import { defaultModelFor, ollamaOpenAiBaseUrl } from '../../shared/providers'
import { resolveServiceTier } from '../../shared/domain/modelSelection'
import { resolveEffectiveSettings } from '../../shared/effectiveSettings'
import { formatError, isAbortError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { stripToolShapedAssistantText } from '../../shared/transcript'
import { getSecret, hasStoredSecretBlob, secretStatus } from '@main/settings/secrets'
import { getSettings } from '@main/settings/settings'
import { findWorkspaceSettingsOverride, readWorkspacesState } from '@main/workspace/workspaces'
import {
  assembleContext,
  allocateBudget,
  buildSessionEnvSection,
  compactionTriggerTokens,
  contentWindow,
  contextWindowFor,
  estimateTextTokensAsync,
  preserveRecentMessagesAsync,
  trimToolsToBudget
} from './context'
import { CONTEXT_TRIM_WATERMARK_SUMMARY, type CompactionRecord } from './context/types'
import { executeStepToolCalls } from './executeStepTools'
import { loadHarness } from './harness'
import { combineLoopHints, loopHintForOmittedMcpTools, maxParallelReadToolsForFailureStreak, seedKnownPathsFromMessages } from './loopPolicy'
import { MAX_PARALLEL_READ_TOOLS } from './tools/classify'
import { getProvider } from './providers'
import { resolveModelInfo } from './modelResolve'
import { requestMaxOutputTokens } from './providers/requestLimits'
import type { ProviderReasoningState } from '../../shared/reasoning'
import { parseProviderReasoningState } from '../../shared/reasoning'
import type { StopReason, TokenUsage, ToolCall } from './providers/types'
import {
  MAX_STREAM_ATTEMPTS,
  shouldRetryProviderStreamError,
  shouldRetryThrownStreamError,
  sleepStreamRetryBackoff
} from './streamRetry'
import { isStreamIdleTimeoutError } from './providers/sse'
import {
  appendEvent,
  appendMessage,
  flushEventAppends,
  flushMessageAppends,
  readContractAsync,
  readPlanAsync
} from './state'
import { AGENT_TOOLS } from './types'
import { listMcpToolDefinitions, parseMcpToolName, syncMcpServers } from './mcp'
import {
  resolveEffectiveMcpServers,
  resolveMcpServersForSessionMap,
  mcpSessionMapFingerprint
} from '../marketplace/resolve'
import { buildSkillsSection, loadEnabledSkills, loadPluginRules } from './skills'
import { isMcpToolPermitted } from '../../shared/utils/mcpToolPolicy'
import { filterToolDefsForMode, modeSectionMarkdown } from './tools/modePolicy'
import { dedupeToolCalls } from './dedupeToolCalls'
import { createApprovalGate, type ToolApprovalGate } from './toolApproval'
import { persistAlwaysAllow } from './toolApprovalStore'
import { toolResultEventForIpc } from '../../shared/utils/toolResultIpc'

export type SubagentUpdate = {
  kind: 'text' | 'thinking' | 'tool' | 'done'
  text: string
}

export type SubagentOutcome = {
  ok: boolean
  report: string
  steps: number
  /** Run-relative path such as `subagents/<id>/report.md` when persisted. */
  reportRel?: string
}

/** Tools a nested agent must not call (depth-1 + avoid flipping parent mode). */
export const NESTED_EXCLUDED_TOOLS = new Set(['subagent', 'switch_mode'])

export const NESTED_ROLE_SECTION = [
  '## Nested agent',
  '',
  'You are a nested agent working for a parent agent on an isolated task.',
  'Use the same tools and standards as the main agent (subject to mode and approval).',
  'You cannot call `subagent` or `switch_mode`.',
  'When finished, stop with a self-contained report — no tool calls.',
  'Answer directly in the first sentence; cite concrete file paths and line numbers;',
  'say plainly what you could not determine rather than guessing.',
  'Your final message is returned to the parent and persisted as report.md.'
].join('\n')

export type NestedAgentOptions = {
  task: string
  context?: string
  workspace: string
  signal: AbortSignal
  depth: number
  parentMode?: AgentInteractionMode
  /** Parent run directory — write checkpoints + report live under this run. */
  runDir?: string
  runId?: string
  invokeId?: number
  parentToolCallId?: string
  /** Pre-allocated nested id (registry id or random). */
  subagentId: string
  /** Parent approval settings gate — when omitted, builds from settings if needed. */
  approval?: ToolApprovalGate
  emit?: (update: SubagentUpdate) => void
  /** Full nested events for rich UI (wrapped by caller as subagent_event). */
  emitNestedEvent?: (event: AgentEvent) => void
  onContextUsage?: (usage: {
    step: number
    estimatedTokens: number
    contextWindow: number
    contentWindow: number
    model: string
  }) => void
}

function lastReasoningState(messages: ChatMessage[]): ProviderReasoningState | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const state = parseProviderReasoningState(m.reasoningState)
    if (state) return state
  }
  return undefined
}

function writeNestedReport(
  runDir: string,
  id: string,
  input: { ok: boolean; report: string; steps: number; task: string }
): string {
  const dir = join(runDir, 'subagents', id)
  mkdirSync(dir, { recursive: true })
  const reportRel = `subagents/${id}/report.md`
  const reportBody = [
    `# Sub-agent report`,
    '',
    `ok: ${input.ok}`,
    `steps: ${input.steps}`,
    '',
    '## Task',
    '',
    input.task.trim() || '(empty)',
    '',
    '## Report',
    '',
    input.report.trim() || '(empty)',
    ''
  ].join('\n')
  writeFileSync(join(runDir, reportRel), reportBody, 'utf8')
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify(
      {
        id,
        ok: input.ok,
        steps: input.steps,
        reportRel,
        taskPreview: input.task.slice(0, 200),
        writtenAt: new Date().toISOString()
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
  return reportRel
}

function finalizeOutcome(
  options: NestedAgentOptions,
  outcome: { ok: boolean; report: string; steps: number }
): SubagentOutcome {
  if (!options.runDir || !existsSync(options.runDir)) {
    return outcome
  }
  try {
    const reportRel = writeNestedReport(options.runDir, options.subagentId, {
      ...outcome,
      task: options.task
    })
    return { ...outcome, reportRel }
  } catch (err) {
    logger.warn('Failed to persist nested agent report', {
      scope: 'agent',
      code: 'SUBAGENT_REPORT',
      err
    })
    return outcome
  }
}

async function flushChildTranscript(childDir: string | null): Promise<void> {
  if (!childDir) return
  await flushMessageAppends(childDir)
  await flushEventAppends(childDir)
}

async function finalizeNested(
  options: NestedAgentOptions,
  outcome: { ok: boolean; report: string; steps: number },
  childDir: string | null
): Promise<SubagentOutcome> {
  await flushChildTranscript(childDir)
  return finalizeOutcome(options, outcome)
}

function ensureChildDir(runDir: string | undefined, id: string): string | null {
  if (!runDir || !existsSync(runDir)) return null
  const dir = join(runDir, 'subagents', id)
  mkdirSync(dir, { recursive: true })
  if (!existsSync(join(dir, 'messages.jsonl'))) {
    writeFileSync(join(dir, 'messages.jsonl'), '', 'utf8')
  }
  if (!existsSync(join(dir, 'events.jsonl'))) {
    writeFileSync(join(dir, 'events.jsonl'), '', 'utf8')
  }
  return dir
}

/**
 * Run a nested agent with the same loop primitives as the main agent.
 * Caller must enforce depth and registry ownership.
 */
export async function runNestedAgent(options: NestedAgentOptions): Promise<SubagentOutcome> {
  const parentMode = options.parentMode ?? 'agent'
  const globalSettings = getSettings()
  const override = findWorkspaceSettingsOverride(readWorkspacesState(), options.workspace)
  const effective = resolveEffectiveSettings(globalSettings, override)
  const settings = { ...DEFAULT_SETTINGS, ...globalSettings, ...effective }
  const parentProvider = settings.provider
  const parentModel = settings.model
  const providerId: ProviderId = settings.subagentProvider ?? parentProvider
  const modelId =
    settings.subagentModel ??
    (settings.subagentProvider && settings.subagentProvider !== parentProvider
      ? defaultModelFor(providerId)
      : parentModel)

  const provider = getProvider(providerId)
  const apiKey = providerId === 'ollama' ? null : getSecret(providerId)
  if (providerId !== 'ollama' && !apiKey) {
    const status = secretStatus()
    const storedBlob = hasStoredSecretBlob(providerId)
    const message = !status.encryptionAvailable
      ? 'OS secure storage is unavailable. API keys cannot be decrypted on this system.'
      : storedBlob
        ? `API key for ${providerId} is stored but cannot be decrypted. Re-enter it in Settings or restore OS keychain access.`
        : `API key for ${providerId} is not set. Add it in Settings.`
    return finalizeOutcome(options, { ok: false, steps: 0, report: message })
  }

  const baseUrl =
    providerId === 'ollama' ? ollamaOpenAiBaseUrl(settings.ollamaBaseUrl) : undefined
  const childDir = ensureChildDir(options.runDir, options.subagentId)
  const parentRunDir = options.runDir
  const runId = options.runId ?? `nested-${options.subagentId}`

  const emitParent = (ev: AgentEvent): void => {
    if (childDir) appendEvent(childDir, ev)
    options.emitNestedEvent?.(ev)
    // Legacy thin progress only when the rich nested-event path is absent.
    if (options.emitNestedEvent) return
    if (ev.type === 'text_delta' && ev.text.trim()) {
      // skip spammy deltas for legacy emit
    } else if (ev.type === 'assistant_message' && ev.content.trim()) {
      options.emit?.({ kind: 'text', text: ev.content.trim() })
    } else if (ev.type === 'tool_start') {
      options.emit?.({ kind: 'tool', text: `${ev.name} ${ev.summary}`.trim() })
    } else if (ev.type === 'thinking_done' && ev.text?.trim()) {
      options.emit?.({ kind: 'thinking', text: ev.text.trim().slice(0, 200) })
    }
  }

  const modelInfo = await resolveModelInfo(
    providerId,
    modelId,
    apiKey,
    baseUrl,
    options.signal
  )

  const harness = loadHarness(options.workspace)
  const marketplaceOverrides = override?.marketplaceOverrides
  const enabledSkills = loadEnabledSkills(marketplaceOverrides)
  const skillsSection = buildSkillsSection(
    enabledSkills,
    Math.floor(allocateBudget(modelInfo).system * 4 * 0.35)
  )
  const pluginRulesSection = loadPluginRules(marketplaceOverrides)

  const approvalSettings = settings.toolApproval ?? DEFAULT_SETTINGS.toolApproval
  const approvalGate: ToolApprovalGate | undefined =
    options.approval ??
    (approvalSettings.mode === 'off'
      ? undefined
      : options.runId
        ? createApprovalGate({
            runId: options.runId,
            invokeId: options.invokeId,
            mode: approvalSettings.mode,
            workspaceAllowlist: approvalSettings.allowlist,
            signal: options.signal,
            persistAlways: (toolName) => persistAlwaysAllow(options.workspace, toolName),
            parentToolCallId: options.parentToolCallId,
            subagentId: options.subagentId
          })
        : undefined)

  let agentMode: AgentInteractionMode = parentMode
  let messages: ChatMessage[] = [
    {
      role: 'user',
      content: options.context
        ? `${options.task}\n\nContext from the parent agent:\n${options.context}`
        : options.task
    }
  ]
  if (childDir) {
    for (const m of messages) void appendMessage(childDir, m)
  }

  let runEnabledMcpIds = new Set<string>()
  let mcpToolPolicies = new Map<string, { allowedTools?: string[]; deniedTools?: string[] }>()
  let toolDefs: { name: string; description: string; parameters: Record<string, unknown> }[] = []
  let toolsJsonEstimate = 0
  let omittedMcpHint: string | undefined
  let lastMcpRefreshFp = ''
  let lastMcpCatalogFp = ''
  let stepMcpToolNames = new Set<string>()
  const runPinnedMcpToolNames = new Set<string>()
  const invalidateMcpToolCatalogCache = (): void => {
    lastMcpCatalogFp = ''
  }

  const refreshMcpToolsForStep = async (): Promise<void> => {
    const refreshFp = `${mcpSessionMapFingerprint()}::${JSON.stringify(marketplaceOverrides ?? null)}`
    const configUnchanged = refreshFp === lastMcpRefreshFp
    lastMcpRefreshFp = refreshFp
    if (!configUnchanged) {
      await syncMcpServers(resolveMcpServersForSessionMap())
    }
    const runMcpServers = resolveEffectiveMcpServers(marketplaceOverrides)
    runEnabledMcpIds = new Set(runMcpServers.filter((s) => s.enabled).map((s) => s.id))
    mcpToolPolicies = new Map(
      runMcpServers
        .filter((s) => s.enabled)
        .map((s) => [
          s.id,
          {
            ...(s.allowedTools?.length ? { allowedTools: s.allowedTools } : {}),
            ...(s.deniedTools?.length ? { deniedTools: s.deniedTools } : {})
          }
        ])
    )
    const pinnedKey = [...runPinnedMcpToolNames].sort().join(',')
    const catalogFp = `${refreshFp}::${agentMode}::${settings.autoModeSwitch ? 1 : 0}::${modelInfo.supportsTools === false ? 0 : 1}::${pinnedKey}::nested`
    if (configUnchanged && catalogFp === lastMcpCatalogFp && lastMcpCatalogFp !== '') {
      return
    }
    lastMcpCatalogFp = catalogFp
    const mcpToolDefs = listMcpToolDefinitions().filter((t) => {
      const parsed = parseMcpToolName(t.name)
      if (parsed == null || !runEnabledMcpIds.has(parsed.serverId)) return false
      const policy = mcpToolPolicies.get(parsed.serverId)
      if (policy && !isMcpToolPermitted(parsed.toolName, policy)) return false
      return true
    })
    const allToolDefs =
      modelInfo.supportsTools !== false
        ? filterToolDefsForMode(agentMode, [...AGENT_TOOLS, ...mcpToolDefs], {
            autoModeSwitch: false
          }).filter((t) => !NESTED_EXCLUDED_TOOLS.has(t.name))
        : []
    const toolBudget = allocateBudget(modelInfo).tools
    const trimmedTools = trimToolsToBudget(allToolDefs, toolBudget, {
      pinnedMcpNames: runPinnedMcpToolNames
    })
    toolDefs = trimmedTools.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>
    }))
    toolsJsonEstimate = trimmedTools.estimate
    omittedMcpHint = loopHintForOmittedMcpTools(trimmedTools.omittedMcpNames)
    stepMcpToolNames = new Set(
      toolDefs.map((t) => t.name).filter((n) => parseMcpToolName(n) != null)
    )
  }

  await refreshMcpToolsForStep()

  let step = 0
  let lastUsage: TokenUsage | undefined
  const compactionState: { current: CompactionRecord | null } = { current: null }
  let foldedMessages = 0
  let overflowRetryUsed = false
  let truncationContinues = 0
  const MAX_TRUNCATION_CONTINUES = 2
  let consecutiveToolFailureSteps = 0
  const knownPaths = seedKnownPathsFromMessages(messages)
  let lastText = ''
  const goal = options.task.slice(0, 500)
  const thinkingEnabled =
    settings.thinkingEnabled && (modelInfo.supportsThinking !== false)

  const persistMsg = (msg: ChatMessage): void => {
    messages.push(msg)
    if (childDir) void appendMessage(childDir, msg)
  }

  while (true) {
    if (options.signal.aborted) break
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (options.signal.aborted) break
    step++

    if (step > 1) await refreshMcpToolsForStep()

    let assistantText = ''
    let thinkingText = ''
    let thinkingDoneEmitted = false
    let stepReasoningState: ProviderReasoningState | undefined
    let stepStopReason: StopReason | undefined
    const toolCalls: ToolCall[] = []
    const pendingToolCalls = new Map<number, ToolCall>()
    const liveForwardedToolIds = new Set<string>()

    const contract = parentRunDir ? await readContractAsync(parentRunDir) : undefined
    const plan = parentRunDir ? await readPlanAsync(parentRunDir) : ''
    const priorCompaction = compactionState.current
    const priorCompactionSummary = priorCompaction?.summary

    const assembled = await assembleContext({
      harness,
      messages,
      workspacePath: options.workspace,
      goal,
      contract,
      plan: plan || undefined,
      sessionEnv: buildSessionEnvSection(agentMode, settings.terminalShell),
      nestedRoleSection: NESTED_ROLE_SECTION,
      model: modelInfo,
      toolsJsonEstimate,
      lastUsage,
      priorCompaction,
      keepRecentTurns: settings.keepRecentTurns,
      compactionTriggerRatio: settings.compactionTriggerRatio,
      skillsSection,
      pluginRulesSection,
      modeSection:
        modeSectionMarkdown(agentMode, { autoModeSwitch: false }) ?? undefined,
      loopHint: combineLoopHints(omittedMcpHint),
      providerId,
      provider,
      apiKey,
      baseUrl,
      signal: options.signal
    })

    const droppedThisStep = assembled.contextShrunk
      ? Math.max(0, messages.length - assembled.messages.length)
      : 0
    const nextFolded = foldedMessages + droppedThisStep
    let compactionWithWatermark: CompactionRecord | null = null
    if (assembled.compaction) {
      compactionWithWatermark = {
        summary: assembled.compaction.summary,
        createdAt: assembled.compaction.createdAt,
        tokenEstimate: assembled.compaction.tokenEstimate,
        foldedMessages: nextFolded
      }
    } else if (assembled.contextShrunk && droppedThisStep > 0) {
      if (priorCompaction) {
        compactionWithWatermark = {
          summary: priorCompaction.summary,
          createdAt: priorCompaction.createdAt,
          tokenEstimate: priorCompaction.tokenEstimate,
          foldedMessages: nextFolded
        }
      } else {
        compactionWithWatermark = {
          summary: CONTEXT_TRIM_WATERMARK_SUMMARY,
          createdAt: new Date().toISOString(),
          tokenEstimate: assembled.estimatedTokens,
          foldedMessages: nextFolded
        }
      }
    }
    if (compactionWithWatermark) compactionState.current = compactionWithWatermark
    if (assembled.contextShrunk || compactionState.current?.summary !== priorCompactionSummary) {
      lastUsage = { inputTokens: assembled.estimatedTokens }
    }
    if (assembled.contextShrunk) {
      foldedMessages += droppedThisStep
      messages = assembled.messages
    }

    const window = contextWindowFor(modelInfo)
    const contentWin = contentWindow(modelInfo)
    const compactionTrigger = compactionTriggerTokens(
      modelInfo,
      settings.compactionTriggerRatio
    )
    options.onContextUsage?.({
      step,
      estimatedTokens: assembled.estimatedTokens,
      contextWindow: window,
      contentWindow: contentWin,
      model: modelId
    })
    const contextEv: AgentEvent = {
      type: 'context_usage',
      runId,
      step,
      estimatedTokens: assembled.estimatedTokens,
      inputTokens: assembled.estimatedTokens,
      contextWindow: window,
      contentWindow: contentWin,
      compactionTrigger,
      source: 'estimate',
      ...(assembled.overflow ? { overflow: true } : {}),
      layers: assembled.layers
    }
    emitParent(contextEv)

    if (assembled.overflow) {
      if (!overflowRetryUsed) {
        overflowRetryUsed = true
        logger.warn('Nested context overflow — retrying once with aggressive keep-recent', {
          scope: 'agent',
          code: 'NESTED_CONTEXT_OVERFLOW_RETRY',
          correlationId: runId,
          step,
          estimatedTokens: assembled.estimatedTokens,
          contentWindow: contentWin
        })
        const retry = await assembleContext({
          harness,
          messages,
          workspacePath: options.workspace,
          goal,
          contract,
          plan: plan || undefined,
          sessionEnv: buildSessionEnvSection(agentMode, settings.terminalShell),
          nestedRoleSection: NESTED_ROLE_SECTION,
          model: modelInfo,
          toolsJsonEstimate,
          lastUsage,
          priorCompaction: compactionState.current,
          keepRecentTurns: 2,
          compactionTriggerRatio: Math.min(settings.compactionTriggerRatio, 0.5),
          skillsSection,
          pluginRulesSection,
          modeSection:
            modeSectionMarkdown(agentMode, { autoModeSwitch: false }) ?? undefined,
          loopHint: combineLoopHints(omittedMcpHint),
          providerId,
          provider,
          apiKey,
          baseUrl,
          signal: options.signal
        })
        if (retry.contextShrunk) {
          const retryDropped = Math.max(0, messages.length - retry.messages.length)
          foldedMessages += retryDropped
          messages = retry.messages
          if (retry.compaction) {
            compactionState.current = {
              ...retry.compaction,
              foldedMessages
            }
            emitParent({
              type: 'compaction',
              runId,
              summary: retry.compaction.summary,
              tokenEstimate: retry.compaction.tokenEstimate
            })
          }
          lastUsage = { inputTokens: retry.estimatedTokens }
        }
        if (!retry.overflow) {
          Object.assign(assembled, retry)
          emitParent({
            type: 'context_usage',
            runId,
            step,
            estimatedTokens: retry.estimatedTokens,
            inputTokens: retry.estimatedTokens,
            contextWindow: window,
            contentWindow: contentWin,
            compactionTrigger,
            source: 'estimate',
            layers: retry.layers
          })
        } else {
          return await finalizeNested(
            options,
            {
              ok: false,
              report: [
                'Nested agent stopped: context still exceeds the model window after trimming.',
                `Estimated ~${retry.estimatedTokens} tokens against a ${window}-token window.`,
                'Narrow the task or ask the parent to summarize earlier findings.'
              ].join(' '),
              steps: step
            },
            childDir
          )
        }
      } else {
        return await finalizeNested(
          options,
          {
            ok: false,
            report: [
              'Nested agent stopped: context still exceeds the model window after trimming.',
              `Estimated ~${assembled.estimatedTokens} tokens against a ${window}-token window.`,
              'Narrow the task or ask the parent to summarize earlier findings.'
            ].join(' '),
            steps: step
          },
          childDir
        )
      }
    }

    let streamAttempt = 0
    let streamFinished = false
    while (!streamFinished && streamAttempt < MAX_STREAM_ATTEMPTS) {
      streamAttempt++
      if (streamAttempt > 1) {
        emitParent({ type: 'stream_reset', runId, step })
      }
      assistantText = ''
      thinkingText = ''
      thinkingDoneEmitted = false
      stepReasoningState = undefined
      stepStopReason = undefined
      toolCalls.length = 0
      pendingToolCalls.clear()
      liveForwardedToolIds.clear()

      let retryStream = false
      try {
        for await (const chunk of provider.streamChat({
          model: modelId,
          messages: assembled.messages,
          tools: toolDefs,
          system: assembled.system,
          signal: options.signal,
          apiKey,
          baseUrl,
          maxOutputTokens: requestMaxOutputTokens(providerId, modelInfo),
          anthropicNative: assembled.anthropicNative,
          strictTools: toolDefs.length > 0,
          toolChoice: toolDefs.length > 0 ? 'auto' : undefined,
          parallelToolCalls: toolDefs.length > 0 ? true : undefined,
          promptCacheKey: `${runId}:${options.subagentId}`,
          modelInfo,
          reasoningState: lastReasoningState(messages),
          thinking: thinkingEnabled
            ? {
                enabled: true,
                effort: settings.thinkingEffort,
                display: settings.showThinking ? 'summarized' : 'omitted'
              }
            : { enabled: false },
          serviceTier: resolveServiceTier(settings, providerId, modelId)
        })) {
          if (options.signal.aborted) break
          if (chunk.type === 'text' && chunk.text) {
            assistantText += chunk.text
            emitParent({ type: 'text_delta', runId, text: chunk.text })
          } else if (chunk.type === 'thinking_delta' && chunk.text) {
            thinkingText += chunk.text
            emitParent({ type: 'thinking_delta', runId, text: chunk.text, step })
          } else if (chunk.type === 'thinking_done') {
            if (chunk.text) thinkingText = chunk.text
            if (!thinkingDoneEmitted) {
              thinkingDoneEmitted = true
              emitParent({
                type: 'thinking_done',
                runId,
                text: thinkingText || chunk.text,
                step
              })
            }
          } else if (chunk.type === 'tool_call_delta' && chunk.toolCallDelta) {
            const delta = chunk.toolCallDelta
            const toolCallId = delta.id ?? `pending_${delta.index}`
            const existing = pendingToolCalls.get(delta.index) ?? {
              id: toolCallId,
              name: '',
              arguments: ''
            }
            if (delta.id) existing.id = delta.id
            if (delta.name) existing.name = delta.name
            if (delta.arguments) existing.arguments += delta.arguments
            pendingToolCalls.set(delta.index, existing)
            liveForwardedToolIds.add(existing.id)
            emitParent({
              type: 'tool_call_delta',
              runId,
              toolCallId: existing.id,
              name: delta.name,
              argumentsDelta: delta.arguments ?? ''
            })
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            toolCalls.push(chunk.toolCall)
            const tc = chunk.toolCall
            for (const [index, pending] of pendingToolCalls) {
              if (pending.id === tc.id) {
                pendingToolCalls.delete(index)
                break
              }
            }
            const already = liveForwardedToolIds.has(tc.id)
            liveForwardedToolIds.add(tc.id)
            emitParent({
              type: 'tool_call_delta',
              runId,
              toolCallId: tc.id,
              name: tc.name,
              argumentsDelta: already ? '' : (tc.arguments ?? '')
            })
          } else if (chunk.type === 'done') {
            if (chunk.reasoningState) stepReasoningState = chunk.reasoningState
            if (chunk.stopReason) stepStopReason = chunk.stopReason
            if (chunk.usage) {
              lastUsage = chunk.usage
              const providerContextEv: AgentEvent = {
                type: 'context_usage',
                runId,
                step,
                estimatedTokens: assembled.estimatedTokens,
                inputTokens: chunk.usage.inputTokens ?? assembled.estimatedTokens,
                contextWindow: window,
                contentWindow: contentWin,
                compactionTrigger,
                source: 'provider'
                // Omit estimate layers — not aligned with provider inputTokens.
              }
              emitParent(providerContextEv)
              options.onContextUsage?.({
                step,
                estimatedTokens: chunk.usage.inputTokens ?? assembled.estimatedTokens,
                contextWindow: window,
                contentWindow: contentWin,
                model: modelId
              })
            }
            if (chunk.compaction?.trim()) {
              const summary = chunk.compaction.trim()
              const keepRecent = settings.keepRecentTurns ?? DEFAULT_SETTINGS.keepRecentTurns
              const historyBudget = allocateBudget(modelInfo).history
              const beforeLen = messages.length
              const kept = await preserveRecentMessagesAsync(
                messages,
                keepRecent,
                historyBudget,
                modelInfo
              )
              const dropped = Math.max(0, beforeLen - kept.length)
              if (dropped > 0) {
                foldedMessages += dropped
                messages = kept
              }
              const prior = compactionState.current
              const record: CompactionRecord = {
                summary,
                createdAt: new Date().toISOString(),
                tokenEstimate: await estimateTextTokensAsync(summary),
                ...(foldedMessages > 0
                  ? { foldedMessages }
                  : prior?.foldedMessages != null
                    ? { foldedMessages: prior.foldedMessages }
                    : {})
              }
              compactionState.current = { ...(prior ?? {}), ...record }
              emitParent({
                type: 'compaction',
                runId,
                summary: record.summary,
                tokenEstimate: record.tokenEstimate
              })
              lastUsage = { inputTokens: assembled.estimatedTokens }
            }
          } else if (chunk.type === 'error') {
            const message = chunk.error ?? 'Provider error'
            if (shouldRetryProviderStreamError(message, streamAttempt)) {
              retryStream = true
              break
            }
            return await finalizeNested(options, {
              ok: false,
              report: `Nested agent failed: ${message}`,
              steps: step
            }, childDir)
          }
        }
        for (const call of pendingToolCalls.values()) {
          if (call.name && !toolCalls.some((t) => t.id === call.id)) {
            toolCalls.push(call)
          }
        }
        pendingToolCalls.clear()
      } catch (err) {
        if (isAbortError(err)) break
        if (isStreamIdleTimeoutError(err)) {
          return await finalizeNested(options, {
            ok: false,
            report: `Nested agent failed: ${err.message}`,
            steps: step
          }, childDir)
        }
        if (shouldRetryThrownStreamError(err, streamAttempt)) {
          retryStream = true
        } else {
          throw err
        }
      }

      if (retryStream) {
        await sleepStreamRetryBackoff(options.signal)
        continue
      }
      streamFinished = true
    }

    if (options.signal.aborted) break

    const uniqueToolCalls = dedupeToolCalls(toolCalls)
    const scrubbed = stripToolShapedAssistantText(assistantText)
    if (scrubbed.trim()) lastText = scrubbed

    if (!uniqueToolCalls.length) {
      const incomplete =
        stepStopReason === 'length' ||
        stepStopReason === 'tool_calls' ||
        (stepStopReason === 'error' && !scrubbed.trim())
      if (incomplete && truncationContinues < MAX_TRUNCATION_CONTINUES) {
        truncationContinues++
        persistMsg({
          role: 'assistant',
          content: scrubbed,
          ...(thinkingText ? { thinking: thinkingText } : {}),
          ...(stepReasoningState ? { reasoningState: stepReasoningState } : {})
        })
        persistMsg({
          role: 'user',
          content: 'Continue from where you left off. Finish the report without repeating.'
        })
        continue
      }

      const report = scrubbed.trim()
      if (!report) {
        return await finalizeNested(options, {
          ok: false,
          report: options.signal.aborted
            ? 'Nested agent was cancelled before it reported anything.'
            : lastText.trim()
              ? 'Nested agent stopped without a final report after using tools.'
              : 'Nested agent finished without producing a report.',
          steps: step
        }, childDir)
      }
      if (thinkingText && !thinkingDoneEmitted) {
        emitParent({ type: 'thinking_done', runId, text: thinkingText, step })
      }
      emitParent({
        type: 'assistant_message',
        runId,
        content: report,
        ...(thinkingText ? { thinking: thinkingText } : {})
      })
      if (!options.emitNestedEvent) {
        options.emit?.({
          kind: 'done',
          text: `Reported in ${step} ${step === 1 ? 'step' : 'steps'}`
        })
      }
      emitParent({ type: 'status', runId, status: 'done' })
      return await finalizeNested(options, { ok: true, report, steps: step }, childDir)
    }

    const mappedCalls = uniqueToolCalls.map((t) => ({
      id: t.id,
      name: t.name,
      arguments: t.arguments
    }))
    const assistantWithTools: ChatMessage = {
      role: 'assistant',
      content: scrubbed,
      toolCalls: mappedCalls,
      ...(thinkingText ? { thinking: thinkingText } : {}),
      ...(stepReasoningState ? { reasoningState: stepReasoningState } : {})
    }
    persistMsg(assistantWithTools)
    if (thinkingText && !thinkingDoneEmitted) {
      emitParent({ type: 'thinking_done', runId, text: thinkingText, step })
    }
    emitParent({
      type: 'assistant_message',
      runId,
      content: scrubbed,
      ...(thinkingText ? { thinking: thinkingText } : {}),
      toolCalls: mappedCalls
    })

    // Reject excluded tools before execution.
    const allowedCalls: ToolCall[] = []
    for (const call of uniqueToolCalls) {
      if (NESTED_EXCLUDED_TOOLS.has(call.name)) {
        const denied: ChatMessage = {
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: `Tool "${call.name}" is not available to nested agents.`,
          ok: false
        }
        persistMsg(denied)
        emitParent({
          type: 'tool_start',
          runId,
          toolCallId: call.id,
          name: call.name,
          summary: 'denied'
        })
        emitParent({
          type: 'tool_result',
          runId,
          toolCallId: call.id,
          name: call.name,
          summary: 'denied',
          ok: false,
          content:
            typeof denied.content === 'string'
              ? denied.content
              : `Tool "${call.name}" is not available to nested agents.`
        })
        continue
      }
      allowedCalls.push(call)
    }

    if (allowedCalls.length === 0) continue

    const toolRunDir = parentRunDir ?? childDir ?? options.workspace
    const liveEvents: AgentEvent[] = []
    let wakeLiveEvents: (() => void) | null = null
    let toolsSettled = false

    const toolCtx = {
      runId,
      runDir: toolRunDir,
      workspace: options.workspace,
      signal: options.signal,
      runSignal: options.signal,
      invokeId: options.invokeId,
      depth: options.depth + 1,
      knownPaths,
      maxParallelReadTools: maxParallelReadToolsForFailureStreak(
        consecutiveToolFailureSteps,
        MAX_PARALLEL_READ_TOOLS
      ),
      appendMessage: async (msg: ChatMessage) => {
        persistMsg(msg)
      },
      appendEvent: (ev: AgentEvent) => {
        if (childDir) appendEvent(childDir, ev)
      },
      approval: approvalGate,
      agentMode,
      getAgentMode: () => agentMode,
      // Nested agents cannot switch mode.
      setAgentMode: undefined,
      autoModeSwitch: false,
      terminalShell: settings.terminalShell,
      diagnosticsCommand: settings.diagnosticsCommand,
      runEnabledMcpIds,
      mcpToolPolicies,
      stepMcpToolNames,
      runPinnedMcpToolNames,
      invalidateMcpToolCatalogCache,
      parentToolCallId: options.parentToolCallId,
      subagentId: options.subagentId,
      emitLiveEvent: (ev: AgentEvent) => {
        liveEvents.push(ev)
        wakeLiveEvents?.()
      }
    }

    const toolWork = executeStepToolCalls(allowedCalls, toolCtx)
    const settledWork = toolWork.then(
      (result) => {
        toolsSettled = true
        wakeLiveEvents?.()
        return result
      },
      (err) => {
        toolsSettled = true
        wakeLiveEvents?.()
        throw err
      }
    )

    for (;;) {
      while (liveEvents.length) {
        const ev = liveEvents.shift()!
        emitParent(ev.type === 'tool_result' ? toolResultEventForIpc(ev) : ev)
      }
      if (toolsSettled) break
      if (options.signal.aborted) break
      await new Promise<void>((resolve) => {
        wakeLiveEvents = resolve
        if (toolsSettled || liveEvents.length) resolve()
      })
      wakeLiveEvents = null
    }

    try {
      const result = await settledWork
      if (allowedCalls.length > 0) {
        if (result.stepToolsOk) consecutiveToolFailureSteps = 0
        else consecutiveToolFailureSteps++
      }
    } catch (err) {
      if (isAbortError(err)) break
      return await finalizeNested(options, {
        ok: false,
        report: `Nested agent tool step failed: ${formatError(err)}`,
        steps: step
      }, childDir)
    }
  }

  return await finalizeNested(options, {
    ok: false,
    report: options.signal.aborted
      ? 'Nested agent was cancelled before it reported anything.'
      : 'Nested agent finished without producing a report.',
    steps: step
  }, childDir)
}

/** Allocate a nested agent id (hex) for report dir + event routing. */
export function allocateNestedAgentId(): string {
  return randomBytes(4).toString('hex')
}
