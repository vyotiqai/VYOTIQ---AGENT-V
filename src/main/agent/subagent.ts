import type { AgentInteractionMode, ChatMessage, ProviderId } from '../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../shared/ipc'
import { defaultModelFor, ollamaOpenAiBaseUrl } from '../../shared/providers'
import { resolveServiceTier } from '../../shared/domain/modelSelection'
import { resolveEffectiveSettings } from '../../shared/effectiveSettings'
import { formatError, isAbortError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { summarizeToolArgs } from '../../shared/toolSummary'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
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
import { dedupeToolCalls } from './dedupeToolCalls'
import { registerSubagent, unregisterSubagent } from './subagentRegistry'
import {
  contentWindow,
  contextWindowFor,
  estimateMessagesTokensAsync,
  estimateSubagentOverheadTokens,
  estimateTextTokensAsync,
  prepareSubagentMessages,
  buildSessionEnvSection
} from './context'
import { buildWorkspaceRulesSection } from './context/rules'

/**
 * Investigation is what a sub-agent is for; anything that changes the workspace
 * stays with the parent, where the user can see and approve it.
 *
 * web_fetch / web_search are omitted — nested network access must go through the
 * parent's approval gate, not a sub-agent allowlist bypass.
 */
export const SUBAGENT_TOOLS = [
  'read',
  'search',
  'glob',
  'grep',
  'list_dir',
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

Your report is persisted under the run directory as subagents/<id>/report.md so the
parent can re-read it after compaction. The parent also receives the report text.`

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

/** Build sub-agent system prompt. Exported for unit tests. */
export function buildSubagentSystem(
  workspaceRules: string,
  tools: readonly string[],
  sessionEnv?: string
): string {
  const parts = [subagentSystemForTools(tools)]
  if (sessionEnv?.trim()) parts.push(sessionEnv.trim())
  const rules = workspaceRules.trim()
  if (rules) {
    const capped = rules.slice(0, SUBAGENT_RULES_MAX_CHARS)
    parts.push(`${capped}${rules.length > capped.length ? '\n… (truncated)' : ''}`)
  }
  return parts.join('\n\n')
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
  /** Parent run directory; when set, the report is written under subagents/<id>/. */
  runDir?: string
  /** Parent run id — enables explicit registry dispose-for-invoke. */
  runId?: string
  /** Parent chat invoke id — scopes registry dispose. */
  invokeId?: number
  /** Parent tool-call id (for registry diagnostics). */
  parentToolCallId?: string
  emit?: (update: SubagentUpdate) => void
  onContextUsage?: (usage: SubagentContextUsage) => void
}

export type SubagentOutcome = {
  ok: boolean
  report: string
  steps: number
  /** Run-relative path such as `subagents/<id>/report.md` when persisted. */
  reportRel?: string
}

/** Persist a sub-agent report under `{runDir}/subagents/<id>/` for post-compaction re-read. */
export function writeSubagentReportFiles(
  runDir: string,
  input: { ok: boolean; report: string; steps: number; task: string }
): { reportRel: string; id: string } {
  const id = randomBytes(4).toString('hex')
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
  return { reportRel, id }
}

function finalizeSubagentOutcome(
  options: SubagentOptions,
  outcome: { ok: boolean; report: string; steps: number }
): SubagentOutcome {
  if (!options.runDir || !existsSync(options.runDir)) {
    return outcome
  }
  try {
    const { reportRel } = writeSubagentReportFiles(options.runDir, {
      ...outcome,
      task: options.task
    })
    return { ...outcome, reportRel }
  } catch (err) {
    logger.warn('Failed to persist sub-agent report', {
      scope: 'agent',
      code: 'SUBAGENT_REPORT',
      err
    })
    return outcome
  }
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

  let registryId: string | undefined
  if (typeof options.runId === 'string' && typeof options.invokeId === 'number') {
    const reg = registerSubagent({
      runId: options.runId,
      invokeId: options.invokeId,
      parentSignal: options.signal,
      parentToolCallId: options.parentToolCallId
    })
    registryId = reg.id
    options = { ...options, signal: reg.signal }
  }

  try {
    return await runSubagentImpl(options)
  } finally {
    if (registryId) unregisterSubagent(registryId)
  }
}

async function runSubagentImpl(options: SubagentOptions): Promise<SubagentOutcome> {
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
    return finalizeSubagentOutcome(options, {
      ok: false,
      steps: 0,
      report: message
    })
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
  const toolsJsonEstimate = tools.length
    ? await estimateTextTokensAsync(JSON.stringify(tools))
    : 0
  const workspaceRules = await buildWorkspaceRulesSection(options.workspace)
  const overheadTokens = estimateSubagentOverheadTokens(
    buildSubagentSystem(
      workspaceRules,
      allowedToolNames,
      buildSessionEnvSection(parentMode, settings.terminalShell)
    ),
    toolsJsonEstimate
  )

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

    const system = buildSubagentSystem(
      workspaceRules,
      allowedToolNames,
      buildSessionEnvSection(parentMode, settings.terminalShell)
    )

    const preparedMessages = prepareSubagentMessages(messages, modelInfo, overheadTokens)
    const estimatedTokens =
      (await estimateMessagesTokensAsync(preparedMessages, modelInfo)) + overheadTokens
    const window = contextWindowFor(modelInfo)
    const contentWin = contentWindow(modelInfo)
    options.onContextUsage?.({
      step: steps,
      estimatedTokens,
      contextWindow: window,
      contentWindow: contentWin,
      model: modelId
    })

    if (estimatedTokens > window) {
      logger.warn('Sub-agent context still exceeds model window after trim', {
        scope: 'agent',
        code: 'SUBAGENT_OVERFLOW',
        step: steps,
        estimatedTokens,
        window
      })
      return finalizeSubagentOutcome(options, {
        ok: false,
        report: [
          'Sub-agent stopped: context still exceeds the model window after trimming.',
          `Estimated ~${estimatedTokens} tokens against a ${window}-token window.`,
          'Narrow the task or ask the parent to summarize earlier findings.'
        ].join(' '),
        steps
      })
    }

    let text = ''
    const toolCalls: ToolCall[] = []
    const pendingToolCalls = new Map<number, ToolCall>()
    let streamFailure: SubagentOutcome | null = null

    try {
      await runWithStreamRetry({
        signal: options.signal,
      onAttemptStart: (attempt) => {
        if (attempt > 1) {
          text = ''
          toolCalls.length = 0
          pendingToolCalls.clear()
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
          } else if (chunk.type === 'tool_call_delta' && chunk.toolCallDelta) {
            const delta = chunk.toolCallDelta
            const existing = pendingToolCalls.get(delta.index) ?? {
              id: delta.id ?? `pending_${delta.index}`,
              name: '',
              arguments: ''
            }
            if (delta.id) existing.id = delta.id
            if (delta.name) existing.name = delta.name
            if (delta.arguments) existing.arguments += delta.arguments
            pendingToolCalls.set(delta.index, existing)
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            toolCalls.push(chunk.toolCall)
            // Drop only the matching pending slot — clearing the whole map drops
            // sibling tools still assembling from deltas when one final arrives.
            for (const [index, pending] of pendingToolCalls) {
              if (pending.id === chunk.toolCall.id) {
                pendingToolCalls.delete(index)
                break
              }
            }
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
        // Providers that stream deltas without a final tool_call still need execution.
        for (const call of pendingToolCalls.values()) {
          if (call.name && !toolCalls.some((t) => t.id === call.id)) {
            toolCalls.push(call)
          }
        }
        pendingToolCalls.clear()
        return 'complete'
      }
      })
    } catch (err) {
      if (isAbortError(err)) break
      throw err
    }

    if (streamFailure) return finalizeSubagentOutcome(options, streamFailure)

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
        return finalizeSubagentOutcome(options, {
          ok: false,
          report: options.signal.aborted
            ? 'Sub-agent was cancelled before it reported anything.'
            : lastText.trim()
              ? 'Sub-agent stopped without a final report after using tools.'
              : 'Sub-agent finished without producing a report.',
          steps
        })
      }
      options.emit?.({
        kind: 'done',
        text: `Reported in ${steps} ${steps === 1 ? 'step' : 'steps'}`
      })
      return finalizeSubagentOutcome(options, { ok: true, report, steps })
    }

    // Gemini re-emits tool_call on mid-stream arg updates; last-wins-by-id like the parent loop.
    const uniqueToolCalls = dedupeToolCalls(toolCalls)
    messages.push({ role: 'assistant', content: text, toolCalls: uniqueToolCalls })

    for (const rawCall of uniqueToolCalls) {
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
          agentMode: 'agent',
          runDir: options.runDir
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

  return finalizeSubagentOutcome(options, {
    ok: false,
    report: options.signal.aborted
      ? 'Sub-agent was cancelled before it reported anything.'
      : 'Sub-agent finished without producing a report.',
    steps
  })
}
