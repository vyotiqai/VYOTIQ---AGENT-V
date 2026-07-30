import type { AgentInteractionMode, ChatMessage, ProviderId } from '../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../shared/ipc'
import { defaultModelFor, ollamaOpenAiBaseUrl } from '../../shared/providers'
import { resolveServiceTier } from '../../shared/domain/modelSelection'
import { resolveEffectiveSettings } from '../../shared/effectiveSettings'
import { formatError, isAbortError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { summarizeToolArgs } from '../../shared/toolSummary'
import { getSecret, hasStoredSecretBlob, secretStatus } from '@main/settings/secrets'
import { getSettings } from '@main/settings/settings'
import { findWorkspaceSettingsOverride, readWorkspacesState } from '@main/workspace/workspaces'
import { getProvider } from './providers'
import {
  runWithStreamRetry,
  shouldRetryProviderStreamError
} from './streamRetry'
import { requestMaxOutputTokens } from './providers/requestLimits'
import { resolveModelInfo } from './modelResolve'
import { AGENT_TOOLS } from './types'
import type { ToolCall } from './providers/types'
import { executeTool } from './tools'
import { repairToolArgs } from './toolArgsRepair'
import {
  contentWindow,
  contextWindowFor,
  estimateMessagesTokens,
  estimateSubagentOverheadTokens,
  estimateTextTokens,
  prepareSubagentMessages
} from './context'
import { buildWorkspaceRulesSection } from './context/rules'

/**
 * Investigation is what a sub-agent is for; anything that changes the workspace
 * stays with the parent, where the user can see and approve it.
 */
export const SUBAGENT_TOOLS = [
  'read',
  'search',
  'glob',
  'grep',
  'list_dir',
  'web_fetch',
  'git_status',
  'git_diff',
  'diagnostics',
  'memory_read'
] as const

export type SubagentToolName = (typeof SUBAGENT_TOOLS)[number]

/** Subagent tools allowed given the parent run mode (Ask cannot spawn diagnostics). */
export function subagentToolsForParentMode(
  parentMode: AgentInteractionMode = 'agent'
): readonly SubagentToolName[] {
  if (parentMode === 'ask') {
    return SUBAGENT_TOOLS.filter((name) => name !== 'diagnostics')
  }
  return SUBAGENT_TOOLS
}

const SUBAGENT_SYSTEM_BASE = `You are a research sub-agent working inside a larger coding agent.

You have read-only tools. You cannot edit files, use the terminal tool, or call MCP tools.

Investigate the task you are given and finish with a single self-contained report:
- Answer the question directly in the first sentence.
- Cite concrete file paths and line numbers for everything you claim.
- Say plainly what you could not determine rather than guessing.

The report is the only thing the parent agent sees, so it must stand on its own.`

function subagentSystemForTools(tools: readonly string[]): string {
  const list = tools.join(', ')
  const diagNote = tools.includes('diagnostics')
    ? 'You may run diagnostics (typecheck/lint). '
    : 'Diagnostics are not available in this sub-agent (parent is in Ask mode). '
  return `${SUBAGENT_SYSTEM_BASE}\n\nAvailable tools: ${list}.\n${diagNote}`
}

function withRepairedArguments(call: ToolCall): ToolCall {
  const raw = call.arguments || '{}'
  try {
    JSON.parse(raw)
    return call
  } catch {
    const repaired = repairToolArgs(raw)
    return repaired ? { ...call, arguments: repaired } : call
  }
}

/** A sub-agent may not spawn another one — callers must pass depth 0 (ceiling is exclusive). */
export const MAX_SUBAGENT_DEPTH = 1

const SUBAGENT_RULES_MAX_CHARS = 64 * 1024

function buildSubagentSystem(workspaceRules: string, tools: readonly string[]): string {
  const base = subagentSystemForTools(tools)
  const rules = workspaceRules.trim()
  if (!rules) return base
  const capped = rules.slice(0, SUBAGENT_RULES_MAX_CHARS)
  return `${base}\n\n${capped}${rules.length > capped.length ? '\n… (truncated)' : ''}`
}

export type SubagentUpdate = {
  kind: 'text' | 'thinking' | 'tool' | 'done'
  text: string
}

export type SubagentContextUsage = {
  step: number
  estimatedTokens: number
  contextWindow: number
  contentWindow: number
  model: string
}

export type SubagentOptions = {
  task: string
  context?: string
  workspace: string
  signal: AbortSignal
  /** Nesting level of the caller: 0 for the top-level run. */
  depth: number
  /** Parent Ask/Plan/Agent mode — Ask strips diagnostics from the child allowlist. */
  parentMode?: AgentInteractionMode
  emit?: (update: SubagentUpdate) => void
  onContextUsage?: (usage: SubagentContextUsage) => void
}

export type SubagentOutcome = {
  ok: boolean
  report: string
  steps: number
}

export class SubagentDepthError extends Error {
  constructor() {
    super('Sub-agents cannot start other sub-agents. Do this work directly instead.')
    this.name = 'SubagentDepthError'
  }
}

function subagentToolDefs(allowedTools: readonly string[]) {
  const allowed = new Set<string>(allowedTools)
  return AGENT_TOOLS.filter((tool) => allowed.has(tool.name)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Record<string, unknown>
  }))
}

/**
 * Run a read-only agent loop and return its report.
 *
 * Each instance manages its own isolated context window; the parent only sees
 * the final report string.
 */
export async function runSubagent(options: SubagentOptions): Promise<SubagentOutcome> {
  if (options.depth >= MAX_SUBAGENT_DEPTH) throw new SubagentDepthError()

  const parentMode = options.parentMode ?? 'agent'
  const allowedToolNames = subagentToolsForParentMode(parentMode)
  const allowedToolSet = new Set<string>(allowedToolNames)

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
    return {
      ok: false,
      steps: 0,
      report: message
    }
  }
  const baseUrl =
    providerId === 'ollama' ? ollamaOpenAiBaseUrl(settings.ollamaBaseUrl) : undefined
  const serviceTier = resolveServiceTier(settings, providerId, modelId)

  const modelInfo = await resolveModelInfo(
    providerId,
    modelId,
    apiKey,
    baseUrl,
    options.signal
  )
  const tools = modelInfo.supportsTools === false ? [] : subagentToolDefs(allowedToolNames)
  const toolsJsonEstimate = tools.length ? estimateTextTokens(JSON.stringify(tools)) : 0
  const system = buildSubagentSystem(
    await buildWorkspaceRulesSection(options.workspace),
    allowedToolNames
  )
  const overheadTokens = estimateSubagentOverheadTokens(system, toolsJsonEstimate)

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: options.context
        ? `${options.task}\n\nContext from the parent agent:\n${options.context}`
        : options.task
    }
  ]

  let steps = 0
  let lastText = ''

  while (true) {
    if (options.signal.aborted) break
    steps++

    const preparedMessages = prepareSubagentMessages(messages, modelInfo, overheadTokens)
    const estimatedTokens =
      estimateMessagesTokens(preparedMessages, modelInfo) + overheadTokens
    const window = contextWindowFor(modelInfo)
    const contentWin = contentWindow(modelInfo)
    options.onContextUsage?.({
      step: steps,
      estimatedTokens,
      contextWindow: window,
      contentWindow: contentWin,
      model: modelId
    })

    let text = ''
    const toolCalls: ToolCall[] = []
    let streamFailure: SubagentOutcome | null = null

    try {
      await runWithStreamRetry({
      onAttemptStart: (attempt) => {
        if (attempt > 1) {
          text = ''
          toolCalls.length = 0
        }
      },
      onRetriableFailure: (err, attempt) => {
        logger.warn('Sub-agent stream disconnected (retrying)', {
          scope: 'agent',
          code: 'PROVIDER_STREAM',
          provider: providerId,
          step: steps,
          attempt,
          err
        })
      },
      runAttempt: async (attempt) => {
        for await (const chunk of provider.streamChat({
          model: modelId,
          messages: preparedMessages,
          tools,
          system,
          signal: options.signal,
          apiKey,
          baseUrl,
          maxOutputTokens: requestMaxOutputTokens(providerId, modelInfo),
          strictTools: tools.length > 0,
          toolChoice: tools.length > 0 ? 'auto' : undefined,
          modelInfo,
          // Nested reasoning would double the transcript noise for a summary the
          // parent never reads; the report is the deliverable.
          thinking: { enabled: false },
          serviceTier
        })) {
          if (options.signal.aborted) break
          if (chunk.type === 'text' && chunk.text) {
            text += chunk.text
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            toolCalls.push(chunk.toolCall)
          } else if (chunk.type === 'error') {
            const message = chunk.error ?? 'Provider error'
            if (shouldRetryProviderStreamError(message, attempt)) {
              logger.warn('Sub-agent stream error (retrying)', {
                scope: 'agent',
                code: 'PROVIDER_STREAM',
                provider: providerId,
                step: steps,
                attempt
              })
              return 'retry'
            }
            logger.warn('Sub-agent stream error', {
              scope: 'agent',
              code: 'PROVIDER_STREAM',
              provider: providerId,
              step: steps
            })
            streamFailure = { ok: false, report: `Sub-agent failed: ${message}`, steps }
            return 'complete'
          }
        }
        return 'complete'
      }
      })
    } catch (err) {
      if (isAbortError(err)) break
      throw err
    }

    if (streamFailure) return streamFailure

    if (options.signal.aborted) break

    if (text.trim()) {
      lastText = text
      options.emit?.({ kind: 'text', text: text.trim() })
    }

    if (!toolCalls.length) {
      // Only the terminal no-tool step counts as the report — earlier narration
      // before tool calls is not a finished answer.
      const report = text.trim()
      if (!report) {
        return {
          ok: false,
          report: options.signal.aborted
            ? 'Sub-agent was cancelled before it reported anything.'
            : lastText.trim()
              ? 'Sub-agent stopped without a final report after using tools.'
              : 'Sub-agent finished without producing a report.',
          steps
        }
      }
      options.emit?.({
        kind: 'done',
        text: `Reported in ${steps} ${steps === 1 ? 'step' : 'steps'}`
      })
      return { ok: true, report, steps }
    }

    messages.push({ role: 'assistant', content: text, toolCalls })

    for (const rawCall of toolCalls) {
      if (options.signal.aborted) break
      const call = withRepairedArguments(rawCall)
      options.emit?.({
        kind: 'tool',
        text: `${call.name} ${summarizeToolArgs(call.name, call.arguments)}`.trim()
      })

      if (!allowedToolSet.has(call.name)) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: `Tool "${call.name}" is not available to sub-agents. Use only: ${allowedToolNames.join(', ')}.`,
          ok: false
        })
        continue
      }

      let content: string
      let ok = false
      try {
        const result = await executeTool(call.name, call.arguments, options.workspace, options.signal, {
          depth: options.depth + 1,
          // Allowlist is the hard gate; use agent mode so Ask does not deny remaining tools.
          // Diagnostics is already stripped from the allowlist when parentMode is ask.
          agentMode: 'agent'
        })
        content = result.content
        ok = result.ok
      } catch (err) {
        if (isAbortError(err)) throw err
        content = `Tool failed: ${formatError(err)}`
        ok = false
      }
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        toolName: call.name,
        content,
        ok
      })
    }
  }

  return {
    ok: false,
    report: options.signal.aborted
      ? 'Sub-agent was cancelled before it reported anything.'
      : 'Sub-agent finished without producing a report.',
    steps
  }
}
