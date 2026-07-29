import { randomUUID } from 'crypto'
import type {
  AgentEvent,
  AgentInteractionMode,
  ChatMessage,
  IncompleteReason,
  ModelInfo,
  ProviderId
} from '../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../shared/ipc'
import { contentDisplayText, contentToText } from '../../shared/ipc'
import { ollamaOpenAiBaseUrl, seedModelsFor } from '../../shared/providers'
import { idSuggestsVision } from './providers/normalize'
import { formatError, isAbortError } from '../../shared/errors'
import { logger, logErrorSummary } from '../../shared/logger'
import { workspaceIdFromPath } from '../../shared/workspaceId'
import {
  isRetriableNetworkError,
  isRetriableProviderMessage,
  RetriableStreamError
} from './providers/fetchWithRetry'
import { resolveEffectiveSettings } from '../../shared/effectiveSettings'
import { resolveServiceTier } from '../../shared/domain/modelSelection'
import { stripToolShapedAssistantText } from '../../shared/transcript'
import { createApprovalGate } from './toolApproval'
import { persistAlwaysAllow } from './toolApprovalStore'
import { getSecret, hasStoredSecretBlob, secretStatus } from '@main/settings/secrets'
import { getSettings } from '@main/settings/settings'
import { findWorkspaceSettingsOverride, readWorkspacesState } from '@main/workspace/workspaces'
import {
  assembleContext,
  allocateBudget,
  compactionTriggerTokens,
  contentWindow,
  contextWindowFor,
  estimateTextTokens,
  ensureMemoryLayout,
  promoteCompactionToMemory,
  preserveRecentMessages,
  trimToolsToBudget,
  type CompactionRecord
} from './context'
import { CONTEXT_TRIM_WATERMARK_SUMMARY, isTrimWatermarkCompaction } from './context/types'
import { executeStepToolCalls } from './executeStepTools'
import { loadHarness } from './harness'
import {
  combineLoopHints,
  loopHintForConsecutiveFailures,
  loopHintForOmittedMcpTools,
  maxParallelReadToolsForFailureStreak
} from './loopPolicy'
import { MAX_PARALLEL_READ_TOOLS } from './tools/classify'
import { getProvider } from './providers'
import { resolveModelInfo } from './modelResolve'
import { requestMaxOutputTokens } from './providers/requestLimits'
import type { ProviderReasoningState } from '../../shared/reasoning'
import { parseProviderReasoningState } from '../../shared/reasoning'
import type { StopReason, TokenUsage, ToolCall } from './providers/types'
import {
  cancelRun,
  clearRunAbort,
  isCurrentInvoke,
  registerRunAbort,
  resetActiveRunsForTests
} from './runRegistry'
import {
  appendEvent,
  appendMessage,
  createRun,
  loadCompaction,
  loadMessages,
  readContractAsync,
  resumeRun,
  saveCompaction,
  syncMessagesAsync,
  updateStatus,
  flushEventAppends,
  flushMessageAppends
} from './state'
import { toolResultEventForIpc, toolResultEventForPersistence } from '../../shared/utils/toolResultIpc'
import { AGENT_TOOLS } from './types'
import { listMcpToolDefinitions, parseMcpToolName, syncMcpServers } from './mcp'
import { resolveEffectiveMcpServers, resolveMcpServersForSessionMap } from '../marketplace/resolve'
import { buildSkillsSection, loadEnabledSkills, loadPluginRules } from './skills'
import { beginWriteCheckpoint, finalizeWriteCheckpoint } from './checkpoints'
import { isMcpToolPermitted } from '../../shared/utils/mcpToolPolicy'
import { filterToolDefsForMode, modeSectionMarkdown } from './tools/modePolicy'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'

export { cancelRun, clearRunAbort, registerRunAbort, resetActiveRunsForTests }

function dedupeToolCalls(calls: ToolCall[]): ToolCall[] {
  const seen = new Map<string, ToolCall>()
  calls.forEach((call, index) => {
    // Without an id there is nothing that reliably identifies a call, and two
    // genuine calls can share name+arguments — key on position so they survive.
    const key = call.id || `@${index}:${call.name}`
    seen.set(key, call)
  })
  return [...seen.values()]
}

const INCOMPLETE_MESSAGES: Record<Exclude<IncompleteReason, never>, string> = {
  truncated: 'The model hit its output token limit before finishing this turn.',
  empty_response: 'The model returned an empty response.',
  filtered: 'The provider stopped the response because of a content filter.'
}

/** True when two messages are the same role + normalized text (resume dedupe). */
function messagesContentEqual(a: ChatMessage, b: ChatMessage): boolean {
  if (a.role !== b.role) return false
  return contentToText(a.content).trim() === contentToText(b.content).trim()
}

/**
 * Drop leading `newMessages` that were already persisted on disk (e.g. retry
 * after chatStart wrote the user turn then failed mid-stream).
 */
function dedupeNewMessagesAgainstDisk(
  diskMessages: ChatMessage[],
  newMessages: ChatMessage[]
): ChatMessage[] {
  if (diskMessages.length === 0 || newMessages.length === 0) return newMessages
  if (messagesContentEqual(diskMessages[diskMessages.length - 1], newMessages[0])) {
    return newMessages.slice(1)
  }
  return newMessages
}

/**
 * Classify a turn that produced no tool calls. `undefined` means the model
 * genuinely finished; anything else means it was cut short.
 */
function classifyIncompleteTurn(
  stopReason: StopReason | undefined,
  assistantText: string,
  thinkingText: string
): IncompleteReason | undefined {
  if (stopReason === 'length') return 'truncated'
  if (stopReason === 'content_filter') return 'filtered'
  // tool_calls with zero parsed tools usually means truncated/malformed deltas,
  // not a genuinely empty model response.
  if (stopReason === 'tool_calls') return 'truncated'
  if (stopReason === 'error') {
    // Only label as empty when nothing was produced; partial text is truncated.
    if (!assistantText.trim() && !thinkingText.trim()) return 'empty_response'
    return 'truncated'
  }
  // Providers sometimes emit `unknown` for truncated/interrupted streams.
  if (stopReason === 'unknown') {
    if (!assistantText.trim() && !thinkingText.trim()) return 'empty_response'
    return 'truncated'
  }
  if (!assistantText.trim() && !thinkingText.trim()) return 'empty_response'
  return undefined
}

export function createRunId(): string {
  return randomUUID()
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

/**
 * Persist whatever the model streamed before the step was interrupted, plus stubs
 * for tool calls that never ran. Without this the transcript loses text the user
 * already watched arrive, because assistant messages are only written on a
 * completed step.
 */
function* flushPartialAssistant(
  runId: string,
  runDir: string,
  messages: ChatMessage[],
  assistantText: string,
  thinkingText: string,
  reasoningState: ProviderReasoningState | undefined,
  toolCalls: ToolCall[],
  interruption: 'cancelled' | 'interrupted'
): Generator<AgentEvent> {
  const scrubbedText = stripToolShapedAssistantText(assistantText)
  if (!scrubbedText && !thinkingText && toolCalls.length === 0) return

  const stub = interruption === 'cancelled' ? 'Cancelled' : 'Interrupted'
  const mappedCalls = toolCalls.map((t) => ({
    id: t.id,
    name: t.name,
    arguments: t.arguments
  }))
  const assistant: ChatMessage = {
    role: 'assistant',
    content: scrubbedText,
    ...(thinkingText ? { thinking: thinkingText } : {}),
    ...(reasoningState ? { reasoningState } : {}),
    ...(mappedCalls.length ? { toolCalls: mappedCalls } : {})
  }
  messages.push(assistant)
  appendMessage(runDir, assistant)
  const assistantEv: AgentEvent = {
    type: 'assistant_message',
    runId,
    content: scrubbedText,
    ...(thinkingText ? { thinking: thinkingText } : {}),
    ...(mappedCalls.length ? { toolCalls: mappedCalls } : {})
  }
  yield assistantEv
  appendEvent(runDir, assistantEv)

  for (const call of toolCalls) {
    const unfinished: ChatMessage = {
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: stub,
      ok: false
    }
    messages.push(unfinished)
    appendMessage(runDir, unfinished)
    const resultEv = {
      type: 'tool_result' as const,
      runId,
      toolCallId: call.id,
      name: call.name,
      summary: interruption,
      ok: false,
      content: stub
    }
    yield toolResultEventForIpc(resultEv)
    appendEvent(runDir, toolResultEventForPersistence(resultEv))
  }
}

export async function* runAgent(input: {
  runId: string
  messages?: ChatMessage[]
  newMessages?: ChatMessage[]
  incremental?: boolean
  workspacePath: string
  resume?: boolean
  /** Ask / Plan / Agent — defaults to agent when omitted. */
  mode?: AgentInteractionMode
}): AsyncGenerator<AgentEvent> {
  const globalSettings = getSettings()
  const workspaces = readWorkspacesState()
  const override = findWorkspaceSettingsOverride(workspaces, input.workspacePath)
  const effective = resolveEffectiveSettings(globalSettings, override)
  const settings = { ...DEFAULT_SETTINGS, ...globalSettings, ...effective }
  const agentMode: AgentInteractionMode = input.mode ?? 'agent'
  const workspace = input.workspacePath
  const runId = input.runId
  const { controller, invokeId } = registerRunAbort(runId, workspace)

  // Entire body in try/finally so early returns (missing key, etc.) always clear the abort map.
  let runDir: string | null = null
  let checkpointFlushed = false
  const writeStatus = (patch: Parameters<typeof updateStatus>[1]): void => {
    if (!runDir || !isCurrentInvoke(runId, invokeId)) return
    updateStatus(runDir, patch)
  }
  const flushWriteCheckpoint = function* (): Generator<AgentEvent, void, unknown> {
    if (!runDir || checkpointFlushed) return
    checkpointFlushed = true
    const meta = finalizeWriteCheckpoint(runDir)
    if (!meta) return
    const ev: AgentEvent = {
      type: 'writes_checkpoint',
      runId,
      checkpointId: meta.id,
      files: meta.files
    }
    appendEvent(runDir, ev)
    yield ev
  }
  try {
    const lastUser = [...(input.messages ?? input.newMessages ?? [])]
      .reverse()
      .find((m) => m.role === 'user')
    // Prefer what the user typed: an attachment's quoted text would make a
    // useless goal line for the workspace snapshot and the run list.
    const goal = lastUser
      ? (contentDisplayText(lastUser.content) || contentToText(lastUser.content)).slice(0, 200)
      : 'chat'
    let messages: ChatMessage[]

    if (input.resume) {
      runDir = resumeRun(workspace, runId)
      const diskMessages = loadMessages(workspace, runId)
      // Always merge from durable disk history on resume so a stale client
      // payload cannot silently rewrite messages.jsonl.
      if (input.newMessages?.length) {
        const toAppend = dedupeNewMessagesAgainstDisk(diskMessages, input.newMessages)
        messages = [...diskMessages, ...toAppend.map((m) => ({ ...m }))]
      } else {
        messages = diskMessages.map((m) => ({ ...m }))
      }
      await syncMessagesAsync(runDir, messages)
    } else {
      messages = (input.messages ?? []).map((m) => ({ ...m }))
      runDir = createRun(workspace, runId, goal)
      for (const m of messages) appendMessage(runDir, m)
    }

    beginWriteCheckpoint(runDir, workspace)

    if (agentMode === 'plan') {
      const planPath = join(runDir, 'plan.md')
      if (!existsSync(planPath)) {
        writeFileSync(
          planPath,
          [
            '# Plan',
            '',
            '_Draft the plan here. Update as you learn. Do not edit product source in Plan mode._',
            ''
          ].join('\n'),
          'utf8'
        )
      }
    }

    let compaction: CompactionRecord | null = loadCompaction(runDir)
    // Everything before the watermark is already represented by the summary, so it
    // never re-enters the working set. `messages.jsonl` still holds the full history
    // for transcript replay and lazy tool-output loads.
    let foldedMessages = compaction?.foldedMessages ?? 0
    if (foldedMessages > 0 && messages.length > 0) {
      // Corrupt/stale watermarks must not drop the latest turn — keep at least
      // the final message in the working set.
      foldedMessages = Math.min(foldedMessages, messages.length - 1)
      messages = messages.slice(foldedMessages)
      while (messages.length > 1 && messages[0].role === 'tool') {
        messages = messages.slice(1)
        foldedMessages++
      }
    } else {
      foldedMessages = 0
    }

    logger.info('Agent run started', {
      scope: 'agent',
      correlationId: runId,
      provider: settings.provider,
      model: settings.model,
      mode: agentMode,
      ...(workspace ? { workspaceId: workspaceIdFromPath(workspace) } : {}),
      resume: Boolean(input.resume)
    })

    yield { type: 'status', runId, status: 'running' }
    appendEvent(runDir, { type: 'status', runId, status: 'running' })

    if (workspace) {
      try {
        ensureMemoryLayout(workspace)
      } catch (err) {
        logger.warn('Failed to ensure memory layout', {
          scope: 'agent',
          code: 'AGENT_LOOP',
          correlationId: runId,
          err
        })
      }
    }

    const harness = loadHarness()
    const providerId: ProviderId = settings.provider
    const provider = getProvider(providerId)

    let apiKey: string | null = null
    if (providerId !== 'ollama') {
      apiKey = getSecret(providerId)
      if (!apiKey) {
        const status = secretStatus()
        const storedBlob = hasStoredSecretBlob(providerId)
        const message = !status.encryptionAvailable
          ? 'OS secure storage is unavailable. API keys cannot be decrypted on this system.'
          : storedBlob
            ? `API key for ${providerId} is stored but cannot be decrypted. Re-enter it in Settings or restore OS keychain access.`
            : `API key for ${providerId} is not set. Add it in Settings.`
        const code = !status.encryptionAvailable
          ? 'PROVIDER_KEYCHAIN'
          : storedBlob
            ? 'PROVIDER_KEY_DECRYPT'
            : 'PROVIDER_AUTH'
        logger.warn(message, {
          scope: 'agent',
          code,
          correlationId: runId,
          provider: providerId
        })
        yield { type: 'error', runId, message, code }
        yield* flushWriteCheckpoint()
        yield { type: 'status', runId, status: 'error' }
        writeStatus({ status: 'error', error: message })
        appendEvent(runDir, { type: 'error', runId, message, code })
        appendEvent(runDir, { type: 'status', runId, status: 'error' })
        return
      }
    }

    let step = 0
    let lastUsage: TokenUsage | undefined

    const approvalSettings = settings.toolApproval ?? DEFAULT_SETTINGS.toolApproval
    // Off is the default, and building a gate then would park nothing — skip it
    // so the common path never touches the approval machinery.
    const approvalGate =
      approvalSettings.mode === 'off'
        ? undefined
        : createApprovalGate({
            runId,
            invokeId,
            mode: approvalSettings.mode,
            workspaceAllowlist: approvalSettings.allowlist,
            signal: controller.signal,
            persistAlways: (toolName) => persistAlwaysAllow(workspace, toolName)
          })

    const emitCompaction = (record: CompactionRecord | null): AgentEvent | null => {
      if (!record || !runDir) return null
      if (
        compaction?.summary === record.summary &&
        compaction?.createdAt === record.createdAt &&
        (compaction?.foldedMessages ?? 0) === (record.foldedMessages ?? 0)
      ) {
        return null
      }
      const summaryChanged =
        compaction?.summary !== record.summary || compaction?.createdAt !== record.createdAt
      compaction = record
      saveCompaction(runDir, record)
      if (workspace && settings.memoryAutoPromote && summaryChanged) {
        try {
          promoteCompactionToMemory(workspace, record)
        } catch (err) {
          logger.warn('Memory auto-promote failed', {
            scope: 'agent',
            correlationId: runId,
            err
          })
        }
      }
      // UI notice only when a real summary changed, not trim watermarks / folded bumps
      if (!summaryChanged || isTrimWatermarkCompaction(record)) {
        return null
      }
      const ev: AgentEvent = {
        type: 'compaction',
        runId,
        summary: record.summary,
        tokenEstimate: record.tokenEstimate
      }
      appendEvent(runDir, ev)
      return ev
    }

    const baseUrl =
      providerId === 'ollama' ? ollamaOpenAiBaseUrl(settings.ollamaBaseUrl) : undefined

    const modelInfo = await resolveModelInfo(
      providerId,
      settings.model,
      apiKey,
      baseUrl,
      controller.signal
    )

    if (controller.signal.aborted) {
      yield* flushWriteCheckpoint()
      yield { type: 'status', runId, status: 'cancelled' }
      writeStatus({ status: 'cancelled' })
      appendEvent(runDir, { type: 'status', runId, status: 'cancelled' })
      return
    }

    // Marketplace Force on/off applies from marketplaceOverrides even when the
    // provider/model workspace override toggle is off.
    const marketplaceOverrides = override?.marketplaceOverrides

    const enabledSkills = loadEnabledSkills(marketplaceOverrides)
    const skillsSection = buildSkillsSection(
      enabledSkills,
      Math.floor(allocateBudget(modelInfo).system * 4 * 0.35)
    )
    const pluginRulesSection = loadPluginRules(marketplaceOverrides)

    let runEnabledMcpIds = new Set<string>()
    let mcpToolPolicies = new Map<
      string,
      { allowedTools?: string[]; deniedTools?: string[] }
    >()
    let toolDefs: { name: string; description: string; parameters: Record<string, unknown> }[] = []
    let toolsJsonEstimate = 0
    let omittedMcpHint: string | undefined

    const refreshMcpToolsForStep = async (): Promise<void> => {
      // Session map unions every open workspace so Force-off only disconnects when
      // no workspace still needs the server. Re-run each step so mid-run enable /
      // reconnect is visible to the model on the next provider call.
      await syncMcpServers(resolveMcpServersForSessionMap())
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
      const mcpToolDefs = listMcpToolDefinitions().filter((t) => {
        const parsed = parseMcpToolName(t.name)
        if (parsed == null || !runEnabledMcpIds.has(parsed.serverId)) return false
        const policy = mcpToolPolicies.get(parsed.serverId)
        if (policy && !isMcpToolPermitted(parsed.toolName, policy)) return false
        return true
      })
      const allToolDefs =
        modelInfo.supportsTools !== false
          ? filterToolDefsForMode(agentMode, [...AGENT_TOOLS, ...mcpToolDefs])
          : []
      const toolBudget = allocateBudget(modelInfo).tools
      const trimmedTools = trimToolsToBudget(allToolDefs, toolBudget)
      toolDefs = trimmedTools.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>
      }))
      toolsJsonEstimate = trimmedTools.estimate
      omittedMcpHint = loopHintForOmittedMcpTools(trimmedTools.omittedMcpNames)
    }

    await refreshMcpToolsForStep()
    const failedToolKeys = new Map<string, number>()
    let consecutiveToolFailureSteps = 0
    let truncationContinues = 0
    const MAX_TRUNCATION_CONTINUES = 2

    while (true) {
      if (controller.signal.aborted) break
      step++
      writeStatus({ step, status: 'running' })
      // Steps after the first pick up MCP servers enabled/reconnected mid-run.
      if (step > 1) await refreshMcpToolsForStep()

      let assistantText = ''
      let thinkingText = ''
      let thinkingDoneEmitted = false
      let stepReasoningState: ProviderReasoningState | undefined
      let stepStopReason: StopReason | undefined
      let stepMalformedChunks = 0
      const toolCalls: ToolCall[] = []
      const liveForwardedToolIds = new Set<string>()
      const persistedLiveToolIds = new Set<string>()
      const thinkingEnabled =
        settings.thinkingEnabled && (modelInfo.supportsThinking !== false)

      const persistLiveToolChrome = (
        toolCallId: string,
        name: string | undefined,
        argumentsDelta: string
      ): void => {
        // One snapshot per id once the name is known — enough for reattach/hydrate
        // without writing every argument delta to events.jsonl.
        if (!runDir || persistedLiveToolIds.has(toolCallId)) return
        if (!name || name === 'tool') return
        persistedLiveToolIds.add(toolCallId)
        appendEvent(runDir, {
          type: 'tool_call_delta',
          runId,
          toolCallId,
          name,
          argumentsDelta
        })
      }

      const priorSummary = compaction?.summary
      const contract = await readContractAsync(runDir)
      const assembled = await assembleContext({
        harness,
        messages,
        workspacePath: workspace,
        goal,
        contract,
        model: modelInfo,
        toolsJsonEstimate,
        lastUsage,
        priorCompaction: compaction,
        keepRecentTurns: settings.keepRecentTurns,
        compactionTriggerRatio: settings.compactionTriggerRatio,
        skillsSection,
        pluginRulesSection,
        modeSection: modeSectionMarkdown(agentMode) ?? undefined,
        loopHint: combineLoopHints(
          omittedMcpHint,
          loopHintForConsecutiveFailures(consecutiveToolFailureSteps)
        ),
        providerId,
        provider,
        apiKey,
        baseUrl,
        signal: controller.signal
      })
      const droppedThisStep = assembled.contextShrunk
        ? Math.max(0, messages.length - assembled.messages.length)
        : 0
      const nextFolded = foldedMessages + droppedThisStep
      let compactionWithWatermark: CompactionRecord | null = null
      if (assembled.compaction) {
        compactionWithWatermark = {
          ...assembled.compaction,
          foldedMessages: nextFolded
        }
      } else if (assembled.contextShrunk && droppedThisStep > 0) {
        // Emergency trim (or fold without a new summary) still needs a durable
        // watermark so resume does not reload the full transcript.
        if (compaction) {
          compactionWithWatermark = { ...compaction, foldedMessages: nextFolded }
        } else {
          compactionWithWatermark = {
            summary: CONTEXT_TRIM_WATERMARK_SUMMARY,
            createdAt: new Date().toISOString(),
            tokenEstimate: assembled.estimatedTokens,
            foldedMessages: nextFolded
          }
        }
      }
      const compactionEv = emitCompaction(compactionWithWatermark)
      if (compactionEv) yield compactionEv
      // Keep the watermark on in-memory state so Anthropic server compaction
      // and later steps do not lose foldedMessages.
      compaction = compactionWithWatermark ?? compaction
      if (assembled.contextShrunk || compaction?.summary !== priorSummary) {
        lastUsage = { inputTokens: assembled.estimatedTokens }
      }
      if (assembled.contextShrunk) {
        // Adopt the reduced set as the working history. Without this the loop keeps
        // handing the full transcript back to assembleContext, which re-summarizes
        // the same prefix on every remaining step.
        foldedMessages += droppedThisStep
        messages = assembled.messages
      }

      const contextWindow = contextWindowFor(modelInfo)
      const effectiveContentWindow = contentWindow(modelInfo)
      const compactionTrigger = compactionTriggerTokens(
        modelInfo,
        settings.compactionTriggerRatio
      )
      // Prefer prior-step provider input tokens for the meter when context did not shrink.
      // After compaction/trim, lastUsage was reset to the estimate above.
      const priorProviderInput =
        lastUsage?.inputTokens && lastUsage.inputTokens > 0 ? lastUsage.inputTokens : undefined
      const usingProviderMeter =
        priorProviderInput != null &&
        !assembled.contextShrunk &&
        compaction?.summary === priorSummary
      const contextUsageEv: AgentEvent = {
        type: 'context_usage',
        runId,
        step,
        estimatedTokens: assembled.estimatedTokens,
        inputTokens: usingProviderMeter ? priorProviderInput : assembled.estimatedTokens,
        contextWindow,
        contentWindow: effectiveContentWindow,
        compactionTrigger,
        source: usingProviderMeter ? 'provider' : 'estimate',
        ...(assembled.overflow ? { overflow: true } : {}),
        layers: assembled.layers
      }
      appendEvent(runDir, contextUsageEv)
      yield contextUsageEv

      const STREAM_RETRY_BACKOFF_MS = 750
      const MAX_STREAM_ATTEMPTS = 2
      let streamAttempt = 0
      let streamFinished = false

      while (!streamFinished && streamAttempt < MAX_STREAM_ATTEMPTS) {
        streamAttempt++
        // Any prior attempt may have streamed text, thinking, or tool deltas —
        // tell the UI to drop all of it before the retry starts clean.
        if (streamAttempt > 1) {
          yield { type: 'stream_reset', runId, step }
        }
        assistantText = ''
        thinkingText = ''
        thinkingDoneEmitted = false
        stepReasoningState = undefined
        stepStopReason = undefined
        stepMalformedChunks = 0
        toolCalls.length = 0
        liveForwardedToolIds.clear()

        let retryStream = false
        try {
          for await (const chunk of provider.streamChat({
          model: settings.model,
          messages: assembled.messages,
          tools: toolDefs,
          system: assembled.system,
          signal: controller.signal,
          apiKey,
          baseUrl,
          maxOutputTokens: requestMaxOutputTokens(providerId, modelInfo),
          anthropicNative: assembled.anthropicNative,
          strictTools: toolDefs.length > 0,
          toolChoice: toolDefs.length > 0 ? 'auto' : undefined,
          parallelToolCalls: toolDefs.length > 0 ? true : undefined,
          promptCacheKey: runId,
          modelInfo,
          reasoningState: lastReasoningState(messages),
          thinking: thinkingEnabled
            ? {
                enabled: true,
                effort: settings.thinkingEffort,
                display: settings.showThinking ? 'summarized' : 'omitted'
              }
            : { enabled: false },
          serviceTier: resolveServiceTier(settings, providerId, settings.model)
        })) {
          if (controller.signal.aborted) break
          if (chunk.type === 'text' && chunk.text) {
            assistantText += chunk.text
            yield { type: 'text_delta', runId, text: chunk.text }
          } else if (chunk.type === 'thinking_delta' && chunk.text) {
            thinkingText += chunk.text
            yield { type: 'thinking_delta', runId, text: chunk.text, step }
          } else if (chunk.type === 'thinking_done') {
            if (chunk.text) thinkingText = chunk.text
            if (!thinkingDoneEmitted) {
              thinkingDoneEmitted = true
              const thinkingDoneEv: AgentEvent = {
                type: 'thinking_done',
                runId,
                text: thinkingText || chunk.text,
                step
              }
              appendEvent(runDir, thinkingDoneEv)
              yield thinkingDoneEv
            }
          } else if (chunk.type === 'tool_call_delta' && chunk.toolCallDelta) {
            const delta = chunk.toolCallDelta
            const toolCallId = delta.id ?? `pending_${delta.index}`
            liveForwardedToolIds.add(toolCallId)
            const argumentsDelta = delta.arguments ?? ''
            persistLiveToolChrome(toolCallId, delta.name, argumentsDelta)
            yield {
              type: 'tool_call_delta',
              runId,
              toolCallId,
              name: delta.name,
              argumentsDelta
            }
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            toolCalls.push(chunk.toolCall)
            // Providers that only emit complete tool_call chunks (e.g. Gemini)
            // never produce tool_call_delta; live-forward so the UI can show
            // tool chrome before assistant_message. Args go out once per id so
            // applyToolCallDelta does not concatenate the full JSON twice.
            const tc = chunk.toolCall
            const already = liveForwardedToolIds.has(tc.id)
            liveForwardedToolIds.add(tc.id)
            const argumentsDelta = already ? '' : (tc.arguments ?? '')
            persistLiveToolChrome(tc.id, tc.name, argumentsDelta || tc.arguments || '')
            yield {
              type: 'tool_call_delta',
              runId,
              toolCallId: tc.id,
              name: tc.name,
              argumentsDelta
            }
          } else if (chunk.type === 'done') {
            if (chunk.reasoningState) stepReasoningState = chunk.reasoningState
            if (chunk.stopReason) stepStopReason = chunk.stopReason
            if (chunk.malformedChunks) {
              stepMalformedChunks = chunk.malformedChunks
              logger.warn('Provider stream dropped malformed frames', {
                scope: 'agent',
                code: 'PROVIDER_STREAM',
                correlationId: runId,
                provider: providerId,
                step,
                malformedChunks: chunk.malformedChunks
              })
            }
            if (chunk.usage) {
              lastUsage = chunk.usage
              const usageEv: AgentEvent = {
                type: 'step_usage',
                runId,
                step,
                inputTokens: chunk.usage.inputTokens,
                outputTokens: chunk.usage.outputTokens,
                cachedInputTokens: chunk.usage.cachedInputTokens,
                reasoningTokens: chunk.usage.reasoningTokens
              }
              appendEvent(runDir, usageEv)
              yield usageEv
              const providerContextEv: AgentEvent = {
                type: 'context_usage',
                runId,
                step,
                estimatedTokens: assembled.estimatedTokens,
                inputTokens: chunk.usage.inputTokens ?? assembled.estimatedTokens,
                contextWindow,
                contentWindow: effectiveContentWindow,
                compactionTrigger,
                source: 'provider',
                ...(assembled.overflow ? { overflow: true } : {}),
                layers: assembled.layers
              }
              // Live UI still needs context_usage; skip a second disk write for the same step.
              yield providerContextEv
              if (chunk.usage.cachedInputTokens && chunk.usage.cachedInputTokens > 0) {
                logger.info('Prompt cache hit', {
                  scope: 'agent',
                  correlationId: runId,
                  provider: providerId,
                  step,
                  cachedInputTokens: chunk.usage.cachedInputTokens,
                  inputTokens: chunk.usage.inputTokens
                })
              }
            }
            if (chunk.compaction?.trim()) {
              const summary = chunk.compaction.trim()
              const keepRecent = settings.keepRecentTurns ?? DEFAULT_SETTINGS.keepRecentTurns
              const historyBudget = allocateBudget(modelInfo).history
              const beforeLen = messages.length
              const kept = preserveRecentMessages(
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
              const record: CompactionRecord = {
                summary,
                createdAt: new Date().toISOString(),
                tokenEstimate: estimateTextTokens(summary),
                ...(foldedMessages > 0
                  ? { foldedMessages }
                  : compaction?.foldedMessages != null
                    ? { foldedMessages: compaction.foldedMessages }
                    : {})
              }
              compaction = { ...(compaction ?? {}), ...record }
              const anthropicCompactionEv = emitCompaction(record)
              if (anthropicCompactionEv) yield anthropicCompactionEv
              // Server-side compaction means prior inputTokens no longer describe the wire payload.
              lastUsage = {
                inputTokens: assembled.estimatedTokens
              }
            }
          } else if (chunk.type === 'error') {
            const message = chunk.error ?? 'Provider error'
            if (
              streamAttempt < MAX_STREAM_ATTEMPTS &&
              isRetriableProviderMessage(message)
            ) {
              logger.warn('Provider stream error (retrying)', {
                scope: 'agent',
                code: 'PROVIDER_STREAM',
                correlationId: runId,
                provider: providerId,
                step,
                attempt: streamAttempt
              })
              retryStream = true
              break
            }
            logger.error('Provider stream error', {
              scope: 'agent',
              code: 'PROVIDER_STREAM',
              correlationId: runId,
              provider: providerId,
              step
            })
            yield* flushPartialAssistant(
              runId,
              runDir,
              messages,
              assistantText,
              thinkingText,
              stepReasoningState,
              dedupeToolCalls(toolCalls),
              'interrupted'
            )
            yield { type: 'error', runId, message, code: 'PROVIDER_STREAM' }
            yield* flushWriteCheckpoint()
            yield { type: 'status', runId, status: 'error' }
            writeStatus({ status: 'error', error: message })
            appendEvent(runDir, { type: 'error', runId, message, code: 'PROVIDER_STREAM' })
            appendEvent(runDir, { type: 'status', runId, status: 'error' })
            return
          }
        }
      } catch (err) {
          if (
            !isAbortError(err) &&
            streamAttempt < MAX_STREAM_ATTEMPTS &&
            (isRetriableNetworkError(err) || err instanceof RetriableStreamError)
          ) {
            logger.warn('Provider stream disconnected (retrying)', {
              scope: 'agent',
              code: 'PROVIDER_STREAM',
              correlationId: runId,
              provider: providerId,
              step,
              attempt: streamAttempt,
              err
            })
            await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_BACKOFF_MS))
            continue
          }
          // Providers rethrow AbortError from SSE readers — treat like an in-loop cancel.
          if (!isAbortError(err)) {
            // Save what already streamed before the throw unwinds to the outer handler,
            // which no longer has access to this step's buffers.
            yield* flushPartialAssistant(
              runId,
              runDir,
              messages,
              assistantText,
              thinkingText,
              stepReasoningState,
              dedupeToolCalls(toolCalls),
              'interrupted'
            )
            throw err
          }
          break
        }

        if (retryStream) {
          await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_BACKOFF_MS))
          continue
        }
        streamFinished = true
      }

      if (controller.signal.aborted) {
        yield* flushPartialAssistant(
          runId,
          runDir,
          messages,
          assistantText,
          thinkingText,
          stepReasoningState,
          dedupeToolCalls(toolCalls),
          'cancelled'
        )
        break
      }

      const uniqueToolCalls = dedupeToolCalls(toolCalls)

      if (uniqueToolCalls.length === 0) {
        if (thinkingText && !thinkingDoneEmitted) {
          thinkingDoneEmitted = true
          const thinkingDoneEv: AgentEvent = {
            type: 'thinking_done',
            runId,
            text: thinkingText,
            step
          }
          appendEvent(runDir, thinkingDoneEv)
          yield thinkingDoneEv
        }
        const scrubbedAssistantText = stripToolShapedAssistantText(assistantText)
        const assistant: ChatMessage = {
          role: 'assistant',
          content: scrubbedAssistantText,
          ...(thinkingText ? { thinking: thinkingText } : {}),
          ...(stepReasoningState ? { reasoningState: stepReasoningState } : {})
        }
        messages.push(assistant)
        appendMessage(runDir, assistant)
        const assistantMsgEv: AgentEvent = {
          type: 'assistant_message',
          runId,
          content: scrubbedAssistantText,
          ...(thinkingText ? { thinking: thinkingText } : {})
        }
        appendEvent(runDir, assistantMsgEv)
        yield assistantMsgEv

        const incomplete = classifyIncompleteTurn(stepStopReason, scrubbedAssistantText, thinkingText)
        if (
          incomplete === 'truncated' &&
          truncationContinues < MAX_TRUNCATION_CONTINUES &&
          !controller.signal.aborted
        ) {
          truncationContinues += 1
          logger.info('Auto-continuing after truncation', {
            scope: 'agent',
            correlationId: runId,
            step,
            truncationContinues
          })
          const continueEv: AgentEvent = {
            type: 'incomplete',
            runId,
            reason: 'truncated',
            step,
            message: `Output was truncated; continuing automatically (${truncationContinues}/${MAX_TRUNCATION_CONTINUES})…`
          }
          appendEvent(runDir, continueEv)
          yield continueEv
          continue
        }
        if (incomplete) {
          const incompleteEv: AgentEvent = {
            type: 'incomplete',
            runId,
            reason: incomplete,
            step,
            message:
              stepMalformedChunks > 0
                ? `${INCOMPLETE_MESSAGES[incomplete]} ${stepMalformedChunks} stream frame(s) could not be parsed and were dropped.`
                : INCOMPLETE_MESSAGES[incomplete]
          }
          logger.warn(`Turn ended incomplete: ${incomplete}`, {
            scope: 'agent',
            code: 'AGENT_INCOMPLETE',
            correlationId: runId,
            provider: providerId,
            step,
            stopReason: stepStopReason ?? 'unset'
          })
          appendEvent(runDir, incompleteEv)
          yield incompleteEv
        }

        yield* flushWriteCheckpoint()
        yield { type: 'status', runId, status: 'done' }
        writeStatus({ status: 'done' })
        appendEvent(runDir, { type: 'status', runId, status: 'done' })
        return
      }

      const mappedCalls = uniqueToolCalls.map((t) => ({
        id: t.id,
        name: t.name,
        arguments: t.arguments
      }))
      const scrubbedAssistantText = stripToolShapedAssistantText(assistantText)
      const assistantWithTools: ChatMessage = {
        role: 'assistant',
        content: scrubbedAssistantText,
        toolCalls: mappedCalls,
        ...(thinkingText ? { thinking: thinkingText } : {}),
        ...(stepReasoningState ? { reasoningState: stepReasoningState } : {})
      }
      messages.push(assistantWithTools)
      appendMessage(runDir, assistantWithTools)
      if (thinkingText && !thinkingDoneEmitted) {
        thinkingDoneEmitted = true
        const thinkingDoneEv: AgentEvent = {
          type: 'thinking_done',
          runId,
          text: thinkingText,
          step
        }
        appendEvent(runDir, thinkingDoneEv)
        yield thinkingDoneEv
      }
      const assistantMsgEv: AgentEvent = {
        type: 'assistant_message',
        runId,
        content: scrubbedAssistantText,
        ...(thinkingText ? { thinking: thinkingText } : {}),
        toolCalls: mappedCalls
      }
      appendEvent(runDir, assistantMsgEv)
      yield assistantMsgEv

      let stepToolsOk = true
      // A tool that thinks for a while (the sub-agent) reports as it goes. The
      // step is a single await, so queue those events and drain them between
      // wakeups instead of holding them until the batch settles.
      const liveEvents: AgentEvent[] = []
      const liveToolResultsEmitted = new Set<string>()
      let wakeLiveEvents: (() => void) | null = null
      const toolCtx = {
        runId,
        runDir: runDir!,
        workspace,
        signal: controller.signal,
        failedToolKeys,
        maxParallelReadTools: maxParallelReadToolsForFailureStreak(
          consecutiveToolFailureSteps,
          MAX_PARALLEL_READ_TOOLS
        ),
        appendMessage: (msg: ChatMessage) => appendMessage(runDir!, msg),
        appendEvent: (ev: AgentEvent) => appendEvent(runDir!, ev),
        approval: approvalGate,
        agentMode,
        runEnabledMcpIds,
        mcpToolPolicies,
        emitLiveEvent: (ev: AgentEvent) => {
          liveEvents.push(ev)
          if (ev.type === 'subagent_update' || ev.type === 'subagent_context_usage') {
            appendEvent(runDir!, ev)
          }
          if (ev.type === 'tool_result') {
            liveToolResultsEmitted.add(ev.toolCallId)
          }
          wakeLiveEvents?.()
        }
      }
      const toolWork = executeStepToolCalls(uniqueToolCalls, toolCtx)
      let toolsSettled = false
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
          yield ev.type === 'tool_result' ? toolResultEventForIpc(ev) : ev
        }
        if (toolsSettled) break
        await Promise.race([
          settledWork.catch(() => undefined),
          new Promise<void>((resolve) => {
            wakeLiveEvents = resolve
          })
        ])
        wakeLiveEvents = null
      }
      const toolOutcome = await settledWork
      for (const ev of toolOutcome.events) {
        if (ev.type === 'tool_result') {
          if (liveToolResultsEmitted.has(ev.toolCallId)) continue
          yield toolResultEventForIpc(ev)
        }
      }
      for (const toolMsg of toolOutcome.messages) {
        messages.push(toolMsg)
        appendMessage(runDir!, toolMsg)
      }
      stepToolsOk = toolOutcome.stepToolsOk

      if (uniqueToolCalls.length > 0) {
        if (stepToolsOk) {
          consecutiveToolFailureSteps = 0
        } else {
          consecutiveToolFailureSteps++
        }
      }

      if (controller.signal.aborted) break
    }

    if (controller.signal.aborted) {
      yield* flushWriteCheckpoint()
      yield { type: 'status', runId, status: 'cancelled' }
      writeStatus({ status: 'cancelled' })
      appendEvent(runDir, { type: 'status', runId, status: 'cancelled' })
    }
  } catch (err) {
    if (isAbortError(err)) {
      logger.warn('Agent run cancelled', { scope: 'agent', correlationId: runId })
      yield* flushWriteCheckpoint()
      yield { type: 'status', runId, status: 'cancelled' }
      if (runDir) {
        writeStatus({ status: 'cancelled' })
        appendEvent(runDir, { type: 'status', runId, status: 'cancelled' })
      }
    } else {
      const message = formatError(err)
      logger.error(`Agent loop failed: ${logErrorSummary(err, 'AGENT_LOOP')}`, {
        scope: 'agent',
        code: 'AGENT_LOOP',
        correlationId: runId,
        err
      })
      yield { type: 'error', runId, message, code: 'AGENT_LOOP' }
      yield* flushWriteCheckpoint()
      yield { type: 'status', runId, status: 'error' }
      if (runDir) {
        writeStatus({ status: 'error', error: message })
        appendEvent(runDir, { type: 'error', runId, message, code: 'AGENT_LOOP' })
        appendEvent(runDir, { type: 'status', runId, status: 'error' })
      }
    }
  } finally {
    // Always drain the per-run append chain so a superseded invoke cannot leave
    // events buffered when a follow-up turn starts immediately.
    if (runDir) {
      if (!checkpointFlushed) {
        const meta = finalizeWriteCheckpoint(runDir)
        checkpointFlushed = true
        if (meta) {
          appendEvent(runDir, {
            type: 'writes_checkpoint',
            runId,
            checkpointId: meta.id,
            files: meta.files
          })
        }
      }
      await flushMessageAppends(runDir)
      await flushEventAppends(runDir)
    }
    clearRunAbort(runId, invokeId)
  }
}
