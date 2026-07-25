import { randomUUID } from 'crypto'
import type { AgentEvent, ChatMessage, ModelInfo, ProviderId } from '../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../shared/ipc'
import { contentToText } from '../../shared/ipc'
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
import { getSecret, secretStatus } from '@main/settings/secrets'
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
  trimToolsToBudget,
  type CompactionRecord
} from './context'
import { executeStepToolCalls } from './executeStepTools'
import { loadHarness } from './harness'
import {
  loopHintForConsecutiveFailures,
  maxParallelReadToolsForFailureStreak
} from './loopPolicy'
import { MAX_PARALLEL_READ_TOOLS } from './tools/classify'
import { getProvider, listProviderModels } from './providers'
import type { ProviderReasoningState } from '../../shared/reasoning'
import { parseProviderReasoningState } from '../../shared/reasoning'
import type { TokenUsage, ToolCall } from './providers/types'
import {
  cancelRun,
  clearRunAbort,
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
  syncMessages,
  updateStatus,
  flushEventAppends
} from './state'
import { toolResultEventForIpc, toolResultEventForPersistence } from '../../shared/utils/toolResultIpc'
import { AGENT_TOOLS } from './types'
import { listMcpToolDefinitions, syncMcpServers } from './mcp'

export { cancelRun, clearRunAbort, registerRunAbort, resetActiveRunsForTests }

function dedupeToolCalls(calls: ToolCall[]): ToolCall[] {
  const seen = new Map<string, ToolCall>()
  for (const call of calls) {
    const key = call.id || `${call.name}:${call.arguments}`
    seen.set(key, call)
  }
  return [...seen.values()]
}

export function createRunId(): string {
  return randomUUID()
}

async function resolveModelInfo(
  providerId: ProviderId,
  modelId: string,
  apiKey: string | null,
  baseUrl: string | undefined,
  signal: AbortSignal
): Promise<ModelInfo> {
  const listed = await listProviderModels({
    provider: providerId,
    apiKey,
    baseUrl,
    signal
  })
  const found = listed.models.find((m) => m.id === modelId)
  if (found) return found
  const seed = seedModelsFor(providerId).find((m) => m.id === modelId)
  if (seed) return seed
  return {
    id: modelId,
    displayName: modelId,
    contextWindow: 128_000,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: providerId !== 'ollama' || /tool|coder|qwen|llama3|mistral/i.test(modelId),
    supportsVision: idSuggestsVision(modelId),
    supportsStructuredOutput: providerId !== 'ollama'
  }
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

/** Persist partial assistant (+ cancelled tool stubs) when a run is aborted mid-step. */
function* flushAbortPartial(
  runId: string,
  runDir: string,
  messages: ChatMessage[],
  assistantText: string,
  thinkingText: string,
  reasoningState: ProviderReasoningState | undefined,
  toolCalls: ToolCall[]
): Generator<AgentEvent> {
  if (!assistantText && !thinkingText && toolCalls.length === 0) return

  const mappedCalls = toolCalls.map((t) => ({
    id: t.id,
    name: t.name,
    arguments: t.arguments
  }))
  const assistant: ChatMessage = {
    role: 'assistant',
    content: assistantText,
    ...(thinkingText ? { thinking: thinkingText } : {}),
    ...(reasoningState ? { reasoningState } : {}),
    ...(mappedCalls.length ? { toolCalls: mappedCalls } : {})
  }
  messages.push(assistant)
  appendMessage(runDir, assistant)
  yield {
    type: 'assistant_message',
    runId,
    content: assistantText,
    ...(thinkingText ? { thinking: thinkingText } : {}),
    ...(mappedCalls.length ? { toolCalls: mappedCalls } : {})
  }
  appendEvent(runDir, {
    type: 'assistant_message',
    runId,
    content: assistantText,
    ...(thinkingText ? { thinking: thinkingText } : {}),
    ...(mappedCalls.length ? { toolCalls: mappedCalls } : {})
  })

  for (const call of toolCalls) {
    const cancelled: ChatMessage = {
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: 'Cancelled'
    }
    messages.push(cancelled)
    appendMessage(runDir, cancelled)
    yield toolResultEventForIpc({
      type: 'tool_result',
      runId,
      toolCallId: call.id,
      name: call.name,
      summary: 'cancelled',
      ok: false,
      content: 'Cancelled'
    })
    appendEvent(runDir, toolResultEventForPersistence({
      type: 'tool_result',
      runId,
      toolCallId: call.id,
      name: call.name,
      summary: 'cancelled',
      ok: false,
      content: 'Cancelled'
    }))
  }
}

export async function* runAgent(input: {
  runId: string
  messages?: ChatMessage[]
  newMessages?: ChatMessage[]
  incremental?: boolean
  workspacePath: string
  resume?: boolean
}): AsyncGenerator<AgentEvent> {
  const globalSettings = getSettings()
  const workspaces = readWorkspacesState()
  const override = findWorkspaceSettingsOverride(workspaces, input.workspacePath)
  const effective = resolveEffectiveSettings(globalSettings, override)
  const settings = { ...DEFAULT_SETTINGS, ...globalSettings, ...effective }
  const workspace = input.workspacePath
  const runId = input.runId
  const { controller, invokeId } = registerRunAbort(runId, workspace)

  // Entire body in try/finally so early returns (missing key, etc.) always clear the abort map.
  let runDir: string | null = null
  try {
    const lastUser = [...(input.messages ?? input.newMessages ?? [])]
      .reverse()
      .find((m) => m.role === 'user')
    const goal = lastUser ? contentToText(lastUser.content).slice(0, 200) : 'chat'
    let messages: ChatMessage[]

    if (input.resume) {
      runDir = resumeRun(workspace, runId)
      if (input.incremental && input.newMessages?.length) {
        const diskMessages = loadMessages(workspace, runId)
        messages = [...diskMessages, ...input.newMessages.map((m) => ({ ...m }))]
        syncMessages(runDir, messages)
      } else {
        messages = (input.messages ?? []).map((m) => ({ ...m }))
        syncMessages(runDir, messages)
      }
    } else {
      messages = (input.messages ?? []).map((m) => ({ ...m }))
      runDir = createRun(workspace, runId, goal)
      for (const m of messages) appendMessage(runDir, m)
    }

    let compaction: CompactionRecord | null = loadCompaction(runDir)

    logger.info('Agent run started', {
      scope: 'agent',
      correlationId: runId,
      provider: settings.provider,
      model: settings.model,
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
        const message = !status.encryptionAvailable
          ? 'OS secure storage is unavailable. API keys cannot be decrypted on this system.'
          : `API key for ${providerId} is not set. Add it in Settings.`
        const code = !status.encryptionAvailable ? 'PROVIDER_KEYCHAIN' : 'PROVIDER_AUTH'
        logger.warn(message, {
          scope: 'agent',
          code,
          correlationId: runId,
          provider: providerId
        })
        yield { type: 'error', runId, message, code }
        yield { type: 'status', runId, status: 'error' }
        updateStatus(runDir, { status: 'error', error: message })
        appendEvent(runDir, { type: 'error', runId, message, code })
        appendEvent(runDir, { type: 'status', runId, status: 'error' })
        return
      }
    }

    const maxSteps = settings.maxSteps
    let step = 0
    let lastStepToolsSucceeded = false
    let lastUsage: TokenUsage | undefined

    const emitCompaction = (record: CompactionRecord | null): AgentEvent | null => {
      if (!record || !runDir) return null
      if (compaction?.summary === record.summary && compaction?.createdAt === record.createdAt) {
        return null
      }
      compaction = record
      saveCompaction(runDir, record)
      if (workspace && settings.memoryAutoPromote) {
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
      yield { type: 'status', runId, status: 'cancelled' }
      updateStatus(runDir, { status: 'cancelled' })
      appendEvent(runDir, { type: 'status', runId, status: 'cancelled' })
      return
    }

    await syncMcpServers(settings.mcpServers)

    const allToolDefs =
      modelInfo.supportsTools !== false
        ? [...AGENT_TOOLS, ...listMcpToolDefinitions()]
        : []
    const toolBudget = allocateBudget(modelInfo).tools
    const trimmedTools = trimToolsToBudget(allToolDefs, toolBudget)
    let toolDefs = trimmedTools.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>
    }))
    let toolsJsonEstimate = trimmedTools.estimate
    const failedToolKeys = new Map<string, number>()
    let consecutiveToolFailureSteps = 0

    while (step < maxSteps) {
      if (controller.signal.aborted) break
      step++
      lastStepToolsSucceeded = false
      updateStatus(runDir, { step, status: 'running' })

      const budgetWarnStep = Math.max(1, Math.ceil(maxSteps * 0.8))
      if (step === budgetWarnStep && maxSteps > 1) {
        const budgetEv: AgentEvent = {
          type: 'step_budget',
          runId,
          step,
          maxSteps,
          ratio: step / maxSteps
        }
        appendEvent(runDir, budgetEv)
        yield budgetEv
      }

      let assistantText = ''
      let thinkingText = ''
      let thinkingDoneEmitted = false
      let stepReasoningState: ProviderReasoningState | undefined
      const toolCalls: ToolCall[] = []
      const thinkingEnabled =
        settings.thinkingEnabled && (modelInfo.supportsThinking !== false)

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
        loopHint: loopHintForConsecutiveFailures(consecutiveToolFailureSteps),
        providerId,
        provider,
        apiKey,
        baseUrl,
        signal: controller.signal
      })
      const compactionEv = emitCompaction(assembled.compaction ?? null)
      if (compactionEv) yield compactionEv
      compaction = assembled.compaction ?? compaction
      if (assembled.contextShrunk || compaction?.summary !== priorSummary) {
        lastUsage = { inputTokens: assembled.estimatedTokens }
      }

      const contextWindow = contextWindowFor(modelInfo)
      const effectiveContentWindow = contentWindow(modelInfo)
      const compactionTrigger = compactionTriggerTokens(
        modelInfo,
        settings.compactionTriggerRatio
      )
      const providerInput =
        lastUsage?.inputTokens && lastUsage.inputTokens > 0
          ? lastUsage.inputTokens
          : assembled.estimatedTokens
      const contextUsageEv: AgentEvent = {
        type: 'context_usage',
        runId,
        step,
        estimatedTokens: assembled.estimatedTokens,
        inputTokens: providerInput,
        contextWindow,
        contentWindow: effectiveContentWindow,
        compactionTrigger,
        source: lastUsage?.inputTokens ? 'provider' : 'estimate',
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
        assistantText = ''
        thinkingText = ''
        thinkingDoneEmitted = false
        stepReasoningState = undefined
        toolCalls.length = 0

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
          maxOutputTokens: modelInfo.maxOutputTokens,
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
          serviceTier: settings.serviceTier
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
            yield {
              type: 'tool_call_delta',
              runId,
              toolCallId: delta.id ?? `pending_${delta.index}`,
              name: delta.name,
              argumentsDelta: delta.arguments ?? ''
            }
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            toolCalls.push(chunk.toolCall)
          } else if (chunk.type === 'done') {
            if (chunk.reasoningState) stepReasoningState = chunk.reasoningState
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
                layers: assembled.layers
              }
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
              const record: CompactionRecord = {
                summary,
                createdAt: new Date().toISOString(),
                tokenEstimate: estimateTextTokens(summary)
              }
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
            yield { type: 'error', runId, message, code: 'PROVIDER_STREAM' }
            yield { type: 'status', runId, status: 'error' }
            updateStatus(runDir, { status: 'error', error: message })
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
          if (!isAbortError(err)) throw err
          break
        }

        if (retryStream) {
          await new Promise((resolve) => setTimeout(resolve, STREAM_RETRY_BACKOFF_MS))
          continue
        }
        streamFinished = true
      }

      if (controller.signal.aborted) {
        yield* flushAbortPartial(
          runId,
          runDir,
          messages,
          assistantText,
          thinkingText,
          stepReasoningState,
          dedupeToolCalls(toolCalls)
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
        const assistant: ChatMessage = {
          role: 'assistant',
          content: assistantText,
          ...(thinkingText ? { thinking: thinkingText } : {}),
          ...(stepReasoningState ? { reasoningState: stepReasoningState } : {})
        }
        messages.push(assistant)
        appendMessage(runDir, assistant)
        const assistantMsgEv: AgentEvent = {
          type: 'assistant_message',
          runId,
          content: assistantText,
          ...(thinkingText ? { thinking: thinkingText } : {})
        }
        appendEvent(runDir, assistantMsgEv)
        yield assistantMsgEv
        yield { type: 'status', runId, status: 'done' }
        updateStatus(runDir, { status: 'done' })
        appendEvent(runDir, { type: 'status', runId, status: 'done' })
        return
      }

      const mappedCalls = uniqueToolCalls.map((t) => ({
        id: t.id,
        name: t.name,
        arguments: t.arguments
      }))
      const assistantWithTools: ChatMessage = {
        role: 'assistant',
        content: assistantText,
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
        content: assistantText,
        ...(thinkingText ? { thinking: thinkingText } : {}),
        toolCalls: mappedCalls
      }
      appendEvent(runDir, assistantMsgEv)
      yield assistantMsgEv

      let stepToolsOk = true
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
        appendEvent: (ev: AgentEvent) => appendEvent(runDir!, ev)
      }
      const toolOutcome = await executeStepToolCalls(uniqueToolCalls, toolCtx)
      for (const ev of toolOutcome.events) {
        if (ev.type === 'tool_start') yield ev
        if (ev.type === 'tool_result') yield toolResultEventForIpc(ev)
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

      if (!controller.signal.aborted && stepToolsOk && uniqueToolCalls.length > 0) {
        lastStepToolsSucceeded = true
      }

      if (controller.signal.aborted) break
    }

    if (controller.signal.aborted) {
      yield { type: 'status', runId, status: 'cancelled' }
      updateStatus(runDir, { status: 'cancelled' })
      appendEvent(runDir, { type: 'status', runId, status: 'cancelled' })
    } else if (lastStepToolsSucceeded) {
      yield { type: 'status', runId, status: 'done' }
      updateStatus(runDir, { status: 'done' })
      appendEvent(runDir, { type: 'status', runId, status: 'done' })
    } else {
      const message = `Stopped after ${maxSteps} steps. Checkpoint durable facts to memory if useful; treat remaining work as partial — summarize what is done vs done-when in contract.md.`
      logger.warn(message, {
        scope: 'agent',
        code: 'AGENT_MAX_STEPS',
        correlationId: runId,
        maxSteps
      })
      yield { type: 'error', runId, message, code: 'AGENT_MAX_STEPS' }
      yield { type: 'status', runId, status: 'error' }
      updateStatus(runDir, { status: 'error', error: message })
      appendEvent(runDir, { type: 'error', runId, message, code: 'AGENT_MAX_STEPS' })
      appendEvent(runDir, { type: 'status', runId, status: 'error' })
    }
  } catch (err) {
    if (isAbortError(err)) {
      logger.warn('Agent run cancelled', { scope: 'agent', correlationId: runId })
      yield { type: 'status', runId, status: 'cancelled' }
      if (runDir) {
        updateStatus(runDir, { status: 'cancelled' })
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
      yield { type: 'status', runId, status: 'error' }
      if (runDir) {
        updateStatus(runDir, { status: 'error', error: message })
        appendEvent(runDir, { type: 'error', runId, message, code: 'AGENT_LOOP' })
        appendEvent(runDir, { type: 'status', runId, status: 'error' })
      }
    }
  } finally {
    if (runDir) await flushEventAppends(runDir)
    clearRunAbort(runId, invokeId)
  }
}
