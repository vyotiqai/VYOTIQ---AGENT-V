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
import { formatError, isAbortError } from '../../shared/errors'
import { logger, logErrorSummary } from '../../shared/logger'
import { workspaceIdFromPath } from '../../shared/workspaceId'
import {
  MAX_STREAM_ATTEMPTS,
  shouldRetryProviderStreamError,
  shouldRetryThrownStreamError,
  sleepStreamRetryBackoff
} from './streamRetry'
import { isStreamIdleTimeoutError } from './providers/sse'
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
  buildSessionEnvSection,
  compactionTriggerTokens,
  contentWindow,
  contextWindowFor,
  estimateTextTokensAsync,
  preserveRecentMessagesAsync,
  applyFoldedMessagesWatermark,
  trimToolsToBudget,
  type CompactionRecord
} from './context'
import { CONTEXT_TRIM_WATERMARK_SUMMARY, isTrimWatermarkCompaction } from './context/types'
import { executeStepToolCalls } from './executeStepTools'
import { loadHarness } from './harness'
import {
  combineLoopHints,
  loopHintForOmittedMcpTools,
  maxParallelReadToolsForFailureStreak
} from './loopPolicy'
import { MAX_PARALLEL_READ_TOOLS } from './tools/classify'
import { disposeTerminalSessionsForInvoke } from './tools/terminalSessions'
import { disposeSubagentsForInvoke } from './subagentRegistry'
import { getProvider } from './providers'
import { resolveModelInfo } from './modelResolve'
import { requestMaxOutputTokens } from './providers/requestLimits'
import type { ProviderReasoningState } from '../../shared/reasoning'
import { parseProviderReasoningState } from '../../shared/reasoning'
import type { StopReason, TokenUsage, ToolCall } from './providers/types'
import {
  cancelRun,
  clearFollowUps,
  clearRunAbort,
  drainFollowUps,
  hasPendingFollowUps,
  isCurrentInvoke,
  markRunTurnComplete,
  registerRunAbort,
  tryBeginRunClosing,
  resetActiveRunsForTests,
  setStreamInterrupt,
  streamSignalFor
} from './runRegistry'
import {
  appendEvent,
  appendMessage,
  createRun,
  loadCompaction,
  loadEvents,
  loadMessages,
  loadStatus,
  readContract,
  readContractAsync,
  readPlanAsync,
  DEFAULT_PLAN_STUB,
  resumeRun,
  saveCompaction,
  syncMessagesAsync,
  updateStatus,
  flushEventAppends,
  flushMessageAppends,
  takeMessageAppendFailureNotice,
  flushStatusWrites,
  loadMessagesAsync
} from './state'
import { writeRunReceiptBestEffort } from './runReceipt'
import { writeTrajectoryArtifactsBestEffort } from './runTrajectory'
import { toolResultEventForIpc, toolResultEventForPersistence } from '../../shared/utils/toolResultIpc'
import { AGENT_TOOLS } from './types'
import { listMcpToolDefinitions, parseMcpToolName, syncMcpServers } from './mcp'
import { resolveEffectiveMcpServers, resolveMcpServersForSessionMap, mcpSessionMapFingerprint } from '../marketplace/resolve'
import { buildSkillsSection, loadEnabledSkills, loadPluginRules } from './skills'
import { beginWriteCheckpoint, finalizeWriteCheckpoint } from './checkpoints'
import { isMcpToolPermitted } from '../../shared/utils/mcpToolPolicy'
import { filterToolDefsForMode, modeSectionMarkdown } from './tools/modePolicy'
import { dedupeToolCalls } from './dedupeToolCalls'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'

export { cancelRun, clearRunAbort, registerRunAbort, resetActiveRunsForTests }

const INCOMPLETE_MESSAGES: Record<Exclude<IncompleteReason, never>, string> = {
  truncated: 'The model hit its output token limit before finishing this turn.',
  empty_response: 'The model returned an empty response.',
  filtered: 'The provider stopped the response because of a content filter.',
  context_overflow:
    'Context still exceeds the model window after compaction. Start a new chat or compact manually.'
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
  const maxOverlap = Math.min(diskMessages.length, newMessages.length)
  for (let count = maxOverlap; count > 0; count--) {
    const diskStart = diskMessages.length - count
    const matches = newMessages
      .slice(0, count)
      .every((message, index) => messagesContentEqual(diskMessages[diskStart + index]!, message))
    if (matches) return newMessages.slice(count)
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
/** Persist and emit mid-run user follow-ups drained from the run registry. */
function* applyDrainedFollowUps(
  runId: string,
  runDir: string,
  messages: ChatMessage[]
): Generator<AgentEvent> {
  const drained = drainFollowUps(runId)
  if (drained.length === 0) return
  const ids: string[] = []
  const applied: ChatMessage[] = []
  for (const entry of drained) {
    messages.push(entry.message)
    appendMessage(runDir, entry.message)
    ids.push(entry.id)
    applied.push(entry.message)
  }
  const ev: AgentEvent = {
    type: 'follow_up_applied',
    runId,
    ids,
    messages: applied
  }
  appendEvent(runDir, ev)
  yield ev
}

/** Surface the first mid-run messages.jsonl append failure as a run error event. */
function* emitMessageAppendFailureNotice(
  runId: string,
  runDir: string,
  invokeId: number
): Generator<AgentEvent> {
  const err = takeMessageAppendFailureNotice(runDir)
  if (!err) return
  const message = `Failed to persist a chat message: ${formatError(err)}`
  logger.error(message, {
    scope: 'agent',
    code: 'PERSIST',
    correlationId: runId,
    err
  })
  const ev: AgentEvent = { type: 'error', runId, invokeId, message, code: 'PERSIST' }
  appendEvent(runDir, ev)
  yield ev
}

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
  let agentMode: AgentInteractionMode = input.mode ?? 'agent'
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
  const flushWriteCheckpoint = function* (opts?: {
    reopen?: boolean
  }): Generator<AgentEvent, void, unknown> {
    if (!runDir || checkpointFlushed) return
    checkpointFlushed = true
    const meta = finalizeWriteCheckpoint(runDir)
    if (meta) {
      const ev: AgentEvent = {
        type: 'writes_checkpoint',
        runId,
        checkpointId: meta.id,
        files: meta.files
      }
      appendEvent(runDir, ev)
      yield ev
    }
    if (opts?.reopen) {
      checkpointFlushed = false
      beginWriteCheckpoint(runDir, workspace)
    }
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
    let initialStep = 0

    if (input.resume) {
      runDir = await resumeRun(workspace, runId)
      const persisted = loadStatus(runDir)
      initialStep = persisted?.step ?? 0
      // Prefer chatStart mode when the UI sent one; otherwise restore last run mode.
      agentMode = input.mode ?? persisted?.mode ?? 'agent'
      const diskMessages = await loadMessagesAsync(workspace, runId)
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
      await flushMessageAppends(runDir)
    }

    writeStatus({ mode: agentMode, invokeId, error: undefined })
    beginWriteCheckpoint(runDir, workspace)

    if (agentMode === 'plan') {
      const planPath = join(runDir, 'plan.md')
      if (!existsSync(planPath)) {
        writeFileSync(planPath, DEFAULT_PLAN_STUB, 'utf8')
      }
    }

    let compaction: CompactionRecord | null = loadCompaction(runDir)
    // Everything before the watermark is already represented by the summary, so it
    // never re-enters the working set. `messages.jsonl` still holds the full history
    // for transcript replay and lazy tool-output loads.
    let foldedMessages = compaction?.foldedMessages ?? 0
    if (foldedMessages > 0 && messages.length > 0) {
      const applied = applyFoldedMessagesWatermark(messages, foldedMessages)
      messages = applied.messages
      foldedMessages = applied.foldedMessages
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

    yield { type: 'status', runId, invokeId, status: 'running' }
    appendEvent(runDir, { type: 'status', runId, invokeId, status: 'running' })

    const harness = loadHarness(workspace)
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
        yield { type: 'error', runId, invokeId, message, code }
        yield* flushWriteCheckpoint()
        yield { type: 'status', runId, invokeId, status: 'error' }
        writeStatus({ status: 'error', error: message })
        appendEvent(runDir, { type: 'error', runId, invokeId, message, code })
        appendEvent(runDir, { type: 'status', runId, invokeId, status: 'error' })
        return
      }
    }

    let step = initialStep
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
            // Soft follow-up interrupt must cancel parked approvals, not only hard cancel.
            signal: streamSignalFor(runId, controller.signal),
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
      clearFollowUps(runId)
      markRunTurnComplete(runId, invokeId)
      yield { type: 'status', runId, invokeId, status: 'cancelled' }
      writeStatus({ status: 'cancelled' })
      appendEvent(runDir, { type: 'status', runId, invokeId, status: 'cancelled' })
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
    let lastMcpRefreshFp = ''
    let lastMcpCatalogFp = ''
    /** MCP tool names in the current step's provider catalog (post budget trim). */
    let stepMcpToolNames = new Set<string>()
    /** Agent-requested MCP tools to prefer in trimToolsToBudget on later steps. */
    const runPinnedMcpToolNames = new Set<string>()
    const invalidateMcpToolCatalogCache = (): void => {
      lastMcpCatalogFp = ''
    }

    const refreshMcpToolsForStep = async (): Promise<void> => {
      // Session map unions every open workspace so Force-off only disconnects when
      // no workspace still needs the server. Skip sync when config fingerprint is
      // unchanged (still rebuild tool defs from connected sessions).
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
      const catalogFp = `${refreshFp}::${agentMode}::${settings.autoModeSwitch ? 1 : 0}::${modelInfo.supportsTools === false ? 0 : 1}::${pinnedKey}`
      if (configUnchanged && catalogFp === lastMcpCatalogFp && lastMcpCatalogFp !== '') {
        // Fingerprint + mode + pins + tools support unchanged — reuse prior trimmed defs.
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
              autoModeSwitch: settings.autoModeSwitch
            })
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
    const failedToolKeys = new Map<string, number>()
    let consecutiveToolFailureSteps = loadStatus(runDir)?.consecutiveToolFailureSteps ?? 0
    let overflowRetryUsed = false
    let truncationContinues = 0
    const MAX_TRUNCATION_CONTINUES = 2

    while (true) {
      if (controller.signal.aborted) break
      // Fairness under many concurrent runs — yield before sync-heavy step work.
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (controller.signal.aborted) break
      // Inject any queued user follow-ups before the next model call.
      yield* applyDrainedFollowUps(runId, runDir, messages)
      yield* emitMessageAppendFailureNotice(runId, runDir, invokeId)
      step++
      const stepSoftAbort = new AbortController()
      setStreamInterrupt(runId, stepSoftAbort)
      try {
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
      const plan = await readPlanAsync(runDir)
      const assembled = await assembleContext({
        harness,
        messages,
        workspacePath: workspace,
        goal,
        contract,
        plan: plan || undefined,
        sessionEnv: buildSessionEnvSection(agentMode, settings.terminalShell),
        model: modelInfo,
        toolsJsonEstimate,
        lastUsage,
        priorCompaction: compaction,
        keepRecentTurns: settings.keepRecentTurns,
        compactionTriggerRatio: settings.compactionTriggerRatio,
        skillsSection,
        pluginRulesSection,
        modeSection:
          modeSectionMarkdown(agentMode, { autoModeSwitch: settings.autoModeSwitch }) ?? undefined,
        loopHint: combineLoopHints(omittedMcpHint),
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

      if (assembled.overflow) {
        if (!overflowRetryUsed) {
          overflowRetryUsed = true
          logger.warn('Context overflow — retrying once with aggressive keep-recent', {
            scope: 'agent',
            code: 'CONTEXT_OVERFLOW_RETRY',
            correlationId: runId,
            step,
            estimatedTokens: assembled.estimatedTokens,
            contentWindow: effectiveContentWindow
          })
          const retry = await assembleContext({
            harness,
            messages,
            workspacePath: workspace,
            goal,
            contract,
            plan: plan || undefined,
            sessionEnv: buildSessionEnvSection(agentMode, settings.terminalShell),
            model: modelInfo,
            toolsJsonEstimate,
            lastUsage,
            priorCompaction: compaction,
            keepRecentTurns: 2,
            compactionTriggerRatio: Math.min(settings.compactionTriggerRatio, 0.5),
            skillsSection,
            pluginRulesSection,
            modeSection:
              modeSectionMarkdown(agentMode, { autoModeSwitch: settings.autoModeSwitch }) ??
              undefined,
            loopHint: combineLoopHints(omittedMcpHint),
            providerId,
            provider,
            apiKey,
            baseUrl,
            signal: controller.signal
          })
          if (retry.contextShrunk) {
            const retryDropped = Math.max(0, messages.length - retry.messages.length)
            foldedMessages += retryDropped
            messages = retry.messages
            if (retry.compaction) {
              compaction = { ...retry.compaction, foldedMessages }
              const retryEv = emitCompaction(compaction)
              if (retryEv) yield retryEv
            }
            lastUsage = { inputTokens: retry.estimatedTokens }
          }
          if (!retry.overflow) {
            // Continue the step with the retried assembly by mutating local state
            // used below — replace estimated tokens / layers via a second usage event.
            const retryUsageEv: AgentEvent = {
              type: 'context_usage',
              runId,
              step,
              estimatedTokens: retry.estimatedTokens,
              inputTokens: retry.estimatedTokens,
              contextWindow,
              contentWindow: effectiveContentWindow,
              compactionTrigger,
              source: 'estimate',
              layers: retry.layers
            }
            appendEvent(runDir, retryUsageEv)
            yield retryUsageEv
            // Fall through to stream using retry.system / messages / tools path.
            // assembleContext return is used via `assembled` below — rebind by continuing
            // with Object.assign onto a let binding. Use system from retry.
            Object.assign(assembled, retry)
          } else {
            const overflowEv: AgentEvent = {
              type: 'incomplete',
              runId,
              invokeId,
              reason: 'context_overflow',
              step,
              message: INCOMPLETE_MESSAGES.context_overflow
            }
            logger.warn('Stopping run: context still exceeds model window after overflow retry', {
              scope: 'agent',
              code: 'CONTEXT_OVERFLOW',
              correlationId: runId,
              step,
              estimatedTokens: retry.estimatedTokens,
              contentWindow: effectiveContentWindow
            })
            appendEvent(runDir, overflowEv)
            yield overflowEv
            yield* flushWriteCheckpoint()
            const closeOverflow = tryBeginRunClosing(runId, invokeId)
            if (closeOverflow === 'has_followups') {
              checkpointFlushed = false
              beginWriteCheckpoint(runDir, workspace)
              yield* applyDrainedFollowUps(runId, runDir, messages)
              continue
            }
            yield { type: 'status', runId, invokeId, status: 'error' }
            writeStatus({
              status: 'error',
              error: INCOMPLETE_MESSAGES.context_overflow
            })
            appendEvent(runDir, { type: 'status', runId, invokeId, status: 'error' })
            return
          }
        } else {
          const overflowEv: AgentEvent = {
            type: 'incomplete',
            runId,
            invokeId,
            reason: 'context_overflow',
            step,
            message: INCOMPLETE_MESSAGES.context_overflow
          }
          logger.warn('Stopping run: context still exceeds model window after compaction', {
            scope: 'agent',
            code: 'CONTEXT_OVERFLOW',
            correlationId: runId,
            step,
            estimatedTokens: assembled.estimatedTokens,
            contentWindow: effectiveContentWindow
          })
          appendEvent(runDir, overflowEv)
          yield overflowEv
          yield* flushWriteCheckpoint()
          const closeOverflow2 = tryBeginRunClosing(runId, invokeId)
          if (closeOverflow2 === 'has_followups') {
            checkpointFlushed = false
            beginWriteCheckpoint(runDir, workspace)
            yield* applyDrainedFollowUps(runId, runDir, messages)
            continue
          }
          yield { type: 'status', runId, invokeId, status: 'error' }
          writeStatus({
            status: 'error',
            error: INCOMPLETE_MESSAGES.context_overflow
          })
          appendEvent(runDir, { type: 'status', runId, invokeId, status: 'error' })
          return
        }
      }

      let streamAttempt = 0
      let streamFinished = false
      let streamSteered = false

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
        streamSteered = false

        let retryStream = false
        try {
          for await (const chunk of provider.streamChat({
          model: settings.model,
          messages: assembled.messages,
          tools: toolDefs,
          system: assembled.system,
          signal: streamSignalFor(runId, controller.signal),
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
          // Soft-steer: break so we can flush partial output and inject follow-ups.
          if (hasPendingFollowUps(runId) || stepSoftAbort.signal.aborted) {
            streamSteered = true
            break
          }
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
                ...(assembled.overflow ? { overflow: true } : {})
                // Omit pre-stream layers — they are estimate splits and mislead
                // when paired with provider-reported inputTokens.
              }
              // Persist so reload/hydration keeps provider-accurate meter (latest wins per step).
              appendEvent(runDir, providerContextEv)
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
              const record: CompactionRecord = {
                summary,
                createdAt: new Date().toISOString(),
                tokenEstimate: await estimateTextTokensAsync(summary),
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
            const errorCode =
              chunk.errorCode === 'PROVIDER_HTTP' ||
              chunk.errorCode === 'PROVIDER_NETWORK' ||
              chunk.errorCode === 'PROVIDER_TIMEOUT'
                ? chunk.errorCode
                : 'PROVIDER_STREAM'
            if (shouldRetryProviderStreamError(message, streamAttempt)) {
              logger.warn('Provider stream error (retrying)', {
                scope: 'agent',
                code: errorCode,
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
              code: errorCode,
              correlationId: runId,
              provider: providerId,
              step,
              message: message.slice(0, 280)
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
            yield { type: 'error', runId, invokeId, message, code: errorCode }
            yield* flushWriteCheckpoint()
            yield { type: 'status', runId, invokeId, status: 'error' }
            writeStatus({ status: 'error', error: message })
            appendEvent(runDir, {
              type: 'error',
              runId,
              invokeId,
              message,
              code: errorCode
            })
            appendEvent(runDir, { type: 'status', runId, invokeId, status: 'error' })
            return
          }
        }
      } catch (err) {
          if (isStreamIdleTimeoutError(err)) {
            const message = err.message
            logger.error('Provider stream idle timeout', {
              scope: 'agent',
              code: 'PROVIDER_TIMEOUT',
              correlationId: runId,
              provider: providerId,
              step,
              idleMs: err.idleMs
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
            yield { type: 'error', runId, invokeId, message, code: 'PROVIDER_TIMEOUT' }
            yield* flushWriteCheckpoint()
            yield { type: 'status', runId, invokeId, status: 'error' }
            writeStatus({ status: 'error', error: message })
            appendEvent(runDir, {
              type: 'error',
              runId,
              invokeId,
              message,
              code: 'PROVIDER_TIMEOUT'
            })
            appendEvent(runDir, { type: 'status', runId, invokeId, status: 'error' })
            return
          }
          if (shouldRetryThrownStreamError(err, streamAttempt)) {
            logger.warn('Provider stream disconnected (retrying)', {
              scope: 'agent',
              code: 'PROVIDER_STREAM',
              correlationId: runId,
              provider: providerId,
              step,
              attempt: streamAttempt,
              err
            })
            await sleepStreamRetryBackoff(streamSignalFor(runId, controller.signal))
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
          // Soft follow-up interrupt (stepSoftAbort) vs full run cancel.
          if (
            !controller.signal.aborted &&
            (hasPendingFollowUps(runId) || stepSoftAbort.signal.aborted)
          ) {
            streamSteered = true
          }
          break
        }

        if (retryStream) {
          await sleepStreamRetryBackoff(streamSignalFor(runId, controller.signal))
          continue
        }
        streamFinished = true
      }

      if (controller.signal.aborted) {
        clearFollowUps(runId)
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

      // Mid-stream steer: keep the turn alive, flush partial output, then inject.
      if (streamSteered) {
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
        yield* applyDrainedFollowUps(runId, runDir, messages)
        continue
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
            invokeId,
            reason: 'truncated',
            step,
            message: `Output was truncated; continuing automatically (${truncationContinues}/${MAX_TRUNCATION_CONTINUES})…`
          }
          appendEvent(runDir, continueEv)
          yield continueEv
          continue
        }

        if (controller.signal.aborted) break

        // User steered during the final stream step — keep going instead of closing.
        if (hasPendingFollowUps(runId)) {
          yield* applyDrainedFollowUps(runId, runDir, messages)
          continue
        }

        if (incomplete) {
          const incompleteEv: AgentEvent = {
            type: 'incomplete',
            runId,
            invokeId,
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
        // Atomically close for follow-ups (or drain and continue) — avoids the
        // TOCTOU window between hasPendingFollowUps and markRunTurnComplete.
        const closeTurn = tryBeginRunClosing(runId, invokeId)
        if (closeTurn === 'has_followups') {
          checkpointFlushed = false
          beginWriteCheckpoint(runDir, workspace)
          yield* applyDrainedFollowUps(runId, runDir, messages)
          continue
        }
        // Surface disk append failures before claiming done — otherwise the UI
        // shows success while messages.jsonl silently lost the last turns.
        try {
          await flushMessageAppends(runDir)
          await flushEventAppends(runDir)
        } catch (persistErr) {
          const message = `Failed to persist run transcript: ${formatError(persistErr)}`
          logger.error(message, {
            scope: 'agent',
            code: 'PERSIST',
            correlationId: runId,
            err: persistErr
          })
          yield { type: 'error', runId, invokeId, message, code: 'PERSIST' }
          yield { type: 'status', runId, invokeId, status: 'error' }
          writeStatus({ status: 'error', error: message })
          appendEvent(runDir, { type: 'error', runId, invokeId, message, code: 'PERSIST' })
          appendEvent(runDir, { type: 'status', runId, invokeId, status: 'error' })
          return
        }
        yield { type: 'status', runId, invokeId, status: 'done' }
        writeStatus({ status: 'done', error: undefined })
        appendEvent(runDir, { type: 'status', runId, invokeId, status: 'done' })
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

      const callsToExecute = uniqueToolCalls

      const toolCtx = {
        runId,
        runDir: runDir!,
        workspace,
        signal: streamSignalFor(runId, controller.signal),
        runSignal: controller.signal,
        invokeId,
        failedToolKeys,
        maxParallelReadTools: maxParallelReadToolsForFailureStreak(
          consecutiveToolFailureSteps,
          MAX_PARALLEL_READ_TOOLS
        ),
        appendMessage: (msg: ChatMessage) => appendMessage(runDir!, msg),
        appendEvent: (ev: AgentEvent) => appendEvent(runDir!, ev),
        approval: approvalGate,
        agentMode,
        getAgentMode: () => agentMode,
        setAgentMode: (mode: AgentInteractionMode) => {
          agentMode = mode
          writeStatus({ mode })
        },
        autoModeSwitch: settings.autoModeSwitch,
        runEnabledMcpIds,
        mcpToolPolicies,
        stepMcpToolNames,
        runPinnedMcpToolNames,
        invalidateMcpToolCatalogCache,
        emitLiveEvent: (ev: AgentEvent) => {
          liveEvents.push(ev)
          if (
            ev.type === 'subagent_update' ||
            ev.type === 'subagent_context_usage' ||
            ev.type === 'subagent_event' ||
            ev.type === 'mode_changed'
          ) {
            appendEvent(runDir!, ev)
          }
          if (ev.type === 'tool_result') {
            liveToolResultsEmitted.add(ev.toolCallId)
          }
          wakeLiveEvents?.()
        }
      }
      const toolWork = executeStepToolCalls(callsToExecute, toolCtx)
      let toolsSteered = false
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
        if (
          !controller.signal.aborted &&
          (hasPendingFollowUps(runId) || stepSoftAbort.signal.aborted)
        ) {
          toolsSteered = true
          // Ensure in-flight tools see soft-abort even if enqueue raced before
          // streamInterrupt was bound, or AbortSignal.any is unavailable.
          if (!stepSoftAbort.signal.aborted) stepSoftAbort.abort()
        }
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
      }

      if (
        !controller.signal.aborted &&
        (toolsSteered || hasPendingFollowUps(runId))
      ) {
        yield* applyDrainedFollowUps(runId, runDir, messages)
        continue
      }

      stepToolsOk = stepToolsOk && toolOutcome.stepToolsOk

      if (uniqueToolCalls.length > 0) {
        if (stepToolsOk) {
          consecutiveToolFailureSteps = 0
          writeStatus({ consecutiveToolFailureSteps: 0 })
        } else {
          consecutiveToolFailureSteps++
          writeStatus({ consecutiveToolFailureSteps })
        }
      }

      if (controller.signal.aborted) break
      } finally {
        setStreamInterrupt(runId, null)
      }
    }

    if (controller.signal.aborted) {
      yield* flushWriteCheckpoint()
      clearFollowUps(runId)
      markRunTurnComplete(runId, invokeId)
      yield { type: 'status', runId, invokeId, status: 'cancelled' }
      writeStatus({ status: 'cancelled' })
      appendEvent(runDir, { type: 'status', runId, invokeId, status: 'cancelled' })
    }
    } catch (err) {
    if (isAbortError(err)) {
      logger.warn('Agent run cancelled', { scope: 'agent', correlationId: runId })
      clearFollowUps(runId)
      markRunTurnComplete(runId, invokeId)
      yield* flushWriteCheckpoint()
      yield { type: 'status', runId, invokeId, status: 'cancelled' }
      if (runDir) {
        writeStatus({ status: 'cancelled' })
        appendEvent(runDir, { type: 'status', runId, invokeId, status: 'cancelled' })
      }
    } else {
      const message = formatError(err)
      logger.error(`Agent loop failed: ${logErrorSummary(err, 'AGENT_LOOP')}`, {
        scope: 'agent',
        code: 'AGENT_LOOP',
        correlationId: runId,
        err
      })
      clearFollowUps(runId)
      markRunTurnComplete(runId, invokeId)
      yield { type: 'error', runId, invokeId, message, code: 'AGENT_LOOP' }
      yield* flushWriteCheckpoint()
      yield { type: 'status', runId, invokeId, status: 'error' }
      if (runDir) {
        writeStatus({ status: 'error', error: message })
        appendEvent(runDir, { type: 'error', runId, invokeId, message, code: 'AGENT_LOOP' })
        appendEvent(runDir, { type: 'status', runId, invokeId, status: 'error' })
      }
    }
  } finally {
    // Persistence flush/receipt must not skip slot teardown — a rethrown append
    // error would otherwise leave isActive(runId) true forever.
    try {
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
        await flushStatusWrites(runDir)
        const receipt = writeRunReceiptBestEffort({
          runDir,
          runId,
          loadStatus,
          loadMessages: () => loadMessages(workspace, runId),
          loadEvents,
          readContract
        })
        // Observational AHE sidecars — best-effort; must not block receipt success.
        writeTrajectoryArtifactsBestEffort({
          runDir,
          runId,
          loadEvents,
          receipt
        })
      }
    } catch (flushErr) {
      logger.warn('Agent run finally persistence failed', {
        scope: 'agent',
        code: 'AGENT_FINALLY_FLUSH',
        correlationId: runId,
        err: flushErr
      })
      if (runDir) {
        try {
          appendEvent(runDir, {
            type: 'error',
            runId,
            invokeId,
            message: `Persistence flush failed after run ended: ${formatError(flushErr)}`,
            code: 'PERSISTENCE'
          })
        } catch {
          // best-effort warning only
        }
      }
    }
    try {
      disposeTerminalSessionsForInvoke(runId, invokeId)
      await disposeSubagentsForInvoke(runId, invokeId)
    } catch (disposeErr) {
      logger.warn('Agent run finally dispose failed', {
        scope: 'agent',
        code: 'AGENT_FINALLY_DISPOSE',
        correlationId: runId,
        err: disposeErr
      })
    } finally {
      clearRunAbort(runId, invokeId)
    }
  }
}
