import type { ChatMessage, ProviderId } from '../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../shared/ipc'
import { ollamaOpenAiBaseUrl } from '../../shared/providers'
import { resolveEffectiveSettings } from '../../shared/effectiveSettings'
import { formatError, isAbortError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { summarizeToolArgs } from '../../shared/toolSummary'
import { getSecret } from '@main/settings/secrets'
import { getSettings } from '@main/settings/settings'
import { findWorkspaceSettingsOverride, readWorkspacesState } from '@main/workspace/workspaces'
import { getProvider } from './providers'
import { resolveModelInfo } from './modelResolve'
import { AGENT_TOOLS } from './types'
import type { ToolCall } from './providers/types'
import { executeTool } from './tools'

/**
 * Investigation is what a sub-agent is for; anything that changes the workspace
 * stays with the parent, where the user can see and approve it.
 */
export const SUBAGENT_TOOLS = ['read', 'search', 'glob', 'grep', 'list_dir'] as const

/** A sub-agent may not spawn another one — one level of nesting, no recursion. */
export const MAX_SUBAGENT_DEPTH = 1
export const SUBAGENT_MAX_STEPS = 8
const MAX_REPORT_CHARS = 12_000

const SUBAGENT_SYSTEM = `You are a research sub-agent working inside a larger coding agent.

You have read-only tools: read, search, glob, grep, list_dir. You cannot edit files or run commands.

Investigate the task you are given and finish with a single self-contained report:
- Answer the question directly in the first sentence.
- Cite concrete file paths and line numbers for everything you claim.
- Say plainly what you could not determine rather than guessing.

The report is the only thing the parent agent sees, so it must stand on its own.`

export type SubagentUpdate = {
  kind: 'text' | 'thinking' | 'tool' | 'done'
  text: string
}

export type SubagentOptions = {
  task: string
  context?: string
  workspace: string
  signal: AbortSignal
  /** Nesting level of the caller: 0 for the top-level run. */
  depth: number
  maxSteps?: number
  emit?: (update: SubagentUpdate) => void
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

function subagentToolDefs() {
  const allowed = new Set<string>(SUBAGENT_TOOLS)
  return AGENT_TOOLS.filter((tool) => allowed.has(tool.name)).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Record<string, unknown>
  }))
}

/**
 * Run a bounded, read-only agent loop and return its report.
 *
 * This is deliberately not the main loop: a sub-agent has no run directory, no
 * compaction, and no place in the run list. It is one tool call that happens to
 * think for a while.
 */
export async function runSubagent(options: SubagentOptions): Promise<SubagentOutcome> {
  if (options.depth >= MAX_SUBAGENT_DEPTH) throw new SubagentDepthError()

  const globalSettings = getSettings()
  const override = findWorkspaceSettingsOverride(readWorkspacesState(), options.workspace)
  const effective = resolveEffectiveSettings(globalSettings, override)
  const settings = { ...DEFAULT_SETTINGS, ...globalSettings, ...effective }
  const providerId: ProviderId = settings.provider
  const provider = getProvider(providerId)
  const apiKey = providerId === 'ollama' ? null : getSecret(providerId)
  const baseUrl = providerId === 'ollama' ? ollamaOpenAiBaseUrl(settings.ollamaBaseUrl) : undefined
  const maxSteps = Math.max(1, options.maxSteps ?? SUBAGENT_MAX_STEPS)

  const modelInfo = await resolveModelInfo(
    providerId,
    settings.model,
    apiKey,
    baseUrl,
    options.signal
  )
  const tools = modelInfo.supportsTools === false ? [] : subagentToolDefs()

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: options.context ? `${options.task}\n\nContext from the parent agent:\n${options.context}` : options.task
    }
  ]

  let steps = 0
  let lastText = ''

  while (steps < maxSteps) {
    if (options.signal.aborted) break
    steps++

    let text = ''
    const toolCalls: ToolCall[] = []

    for await (const chunk of provider.streamChat({
      model: settings.model,
      messages,
      tools,
      system: SUBAGENT_SYSTEM,
      signal: options.signal,
      apiKey,
      baseUrl,
      maxOutputTokens: modelInfo.maxOutputTokens,
      strictTools: tools.length > 0,
      toolChoice: tools.length > 0 ? 'auto' : undefined,
      modelInfo,
      // Nested reasoning would double the transcript noise for a summary the
      // parent never reads; the report is the deliverable.
      thinking: { enabled: false },
      serviceTier: settings.serviceTier
    })) {
      if (options.signal.aborted) break
      if (chunk.type === 'text' && chunk.text) {
        text += chunk.text
      } else if (chunk.type === 'tool_call' && chunk.toolCall) {
        toolCalls.push(chunk.toolCall)
      } else if (chunk.type === 'error') {
        const message = chunk.error ?? 'Provider error'
        logger.warn('Sub-agent stream error', {
          scope: 'agent',
          code: 'PROVIDER_STREAM',
          provider: providerId,
          step: steps
        })
        return { ok: false, report: `Sub-agent failed: ${message}`, steps }
      }
    }

    if (text.trim()) {
      lastText = text
      options.emit?.({ kind: 'text', text: text.trim() })
    }

    if (!toolCalls.length) break

    messages.push({ role: 'assistant', content: text, toolCalls })

    for (const call of toolCalls) {
      if (options.signal.aborted) break
      options.emit?.({ kind: 'tool', text: `${call.name} ${summarizeToolArgs(call.name, call.arguments)}`.trim() })
      let content: string
      try {
        const result = await executeTool(call.name, call.arguments, options.workspace, options.signal, {
          depth: options.depth + 1
        })
        content = result.content
      } catch (err) {
        if (isAbortError(err)) throw err
        content = `Tool failed: ${formatError(err)}`
      }
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        toolName: call.name,
        content
      })
    }
  }

  const report = lastText.trim()
  if (!report) {
    return {
      ok: false,
      report: options.signal.aborted
        ? 'Sub-agent was cancelled before it reported anything.'
        : 'Sub-agent finished without producing a report.',
      steps
    }
  }

  const capped =
    report.length > MAX_REPORT_CHARS
      ? `${report.slice(0, MAX_REPORT_CHARS)}\n\n[report truncated]`
      : report
  options.emit?.({ kind: 'done', text: `Reported in ${steps} ${steps === 1 ? 'step' : 'steps'}` })
  return { ok: true, report: capped, steps }
}
