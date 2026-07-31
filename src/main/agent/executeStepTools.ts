import type { AgentEvent, AgentInteractionMode, ChatMessage } from '../../shared/ipc'
import { isAbortError, isExpectedToolError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { summarizeToolArgs } from '../../shared/toolSummary'
import { toolResultEventForPersistence } from '../../shared/utils/toolResultIpc'
import type { ToolCall } from './providers/types'
import { executeTool } from '@main/agent/tools'
import { isParallelSafeTool, MAX_PARALLEL_READ_TOOLS, MAX_PARALLEL_SUBAGENTS } from './tools/classify'
import { repairToolArgs } from './toolArgsRepair'
import type { ToolApprovalGate } from './toolApproval'

export type ToolStepContext = {
  runId: string
  runDir: string
  workspace: string
  /** Combined run cancel + soft stream / follow-up interrupt. */
  signal: AbortSignal
  /** Run-level cancel only — distinguishes Interrupted vs Cancelled. */
  runSignal?: AbortSignal
  appendMessage: (msg: ChatMessage) => Promise<void>
  appendEvent: (ev: AgentEvent) => void
  /** Per-run failed tool keys (`tool:summary`) for repeat-failure hints. */
  failedToolKeys?: Map<string, number>
  /** Override parallel read batch size (e.g. 1 after consecutive failure steps). */
  maxParallelReadTools?: number
  /** Present only when the workspace opted into tool approval. */
  approval?: ToolApprovalGate
  /** ChatStart invoke that owns this step; scopes interactive cancel. */
  invokeId?: number
  /** Ask / Plan / Agent for this invoke (mutable via switch_mode). */
  agentMode?: AgentInteractionMode
  getAgentMode?: () => AgentInteractionMode
  setAgentMode?: (mode: AgentInteractionMode) => void
  /** Streams events while a tool is still running (sub-agent progress). */
  emitLiveEvent?: (ev: AgentEvent) => void
  /**
   * MCP servers enabled for this run (workspace overrides applied).
   * Enforced at invoke time so Force-off cannot be bypassed via stale tool names.
   */
  runEnabledMcpIds?: ReadonlySet<string>
  /** Per-server allow/deny for bare MCP tool names. */
  mcpToolPolicies?: ReadonlyMap<string, { allowedTools?: string[]; deniedTools?: string[] }>
}

/**
 * Applied in call order after a batch settles, not inside the parallel workers:
 * whichever call happens to finish first should not decide who gets the hint.
 */
function applyRepeatFailureHint(
  ctx: ToolStepContext,
  outcome: ToolOutcome
): ToolOutcome {
  const key = outcome.failureKey
  if (!key || !ctx.failedToolKeys) return outcome
  const count = (ctx.failedToolKeys.get(key) ?? 0) + 1
  ctx.failedToolKeys.set(key, count)
  if (count < 2) return outcome

  const summary = key.slice(key.indexOf(':') + 1)
  const prefix = `[Repeated failure #${count} for ${summary} — stop guessing paths; read README/manifests, then use search or dir.]`
  const withHint = (text: string): string => [prefix, text].join('\n')

  return {
    ...outcome,
    message: {
      ...outcome.message,
      content: withHint(
        typeof outcome.message.content === 'string' ? outcome.message.content : ''
      )
    },
    events: outcome.events.map((ev) =>
      ev.type === 'tool_result' && ev.content !== undefined
        ? { ...ev, content: withHint(ev.content) }
        : ev
    )
  }
}

function isMalformedToolCall(call: ToolCall): string | null {
  if (!call.name?.trim()) return 'Tool call missing name'
  if (!call.id?.trim()) return 'Tool call missing id'
  try {
    JSON.parse(call.arguments || '{}')
  } catch {
    return 'Tool call arguments are not valid JSON'
  }
  return null
}

/**
 * A truncated stream leaves structurally unfinished arguments that are still
 * usable once the punctuation is closed. Repair before validation so one lost
 * frame does not cost the model a whole tool call.
 */
function withRepairedArguments(call: ToolCall, ctx: ToolStepContext): ToolCall {
  const raw = call.arguments || '{}'
  try {
    JSON.parse(raw)
    return call
  } catch {
    const repaired = repairToolArgs(raw)
    if (!repaired) return call
    logger.warn('Repaired truncated tool call arguments', {
      scope: 'agent',
      code: 'TOOL_ARGS',
      correlationId: ctx.runId,
      tool: call.name || 'unknown'
    })
    return { ...call, arguments: repaired }
  }
}

type ToolOutcome = {
  ok: boolean
  events: AgentEvent[]
  message: ChatMessage
  /** `name:summary` when this was an expected failure eligible for a repeat hint. */
  failureKey?: string
}

function abortToolContent(ctx: ToolStepContext): string {
  const runAborted = ctx.runSignal?.aborted ?? ctx.signal.aborted
  if (runAborted) return 'Cancelled'
  if (ctx.signal.aborted) return 'Interrupted'
  return 'Cancelled'
}

function abortToolSummary(ctx: ToolStepContext): string {
  return abortToolContent(ctx).toLowerCase()
}

function emitToolStart(ctx: ToolStepContext, event: AgentEvent): void {
  ctx.appendEvent(event)
  ctx.emitLiveEvent?.(event)
}

function emitToolResult(ctx: ToolStepContext, event: AgentEvent): void {
  if (event.type !== 'tool_result') return
  ctx.emitLiveEvent?.(event)
}

async function runSingleTool(rawCall: ToolCall, ctx: ToolStepContext): Promise<ToolOutcome> {
  const events: AgentEvent[] = []
  const call = withRepairedArguments(rawCall, ctx)
  const malformed = isMalformedToolCall(call)
  if (malformed) {
    logger.warn('Malformed tool call', {
      scope: 'agent',
      code: 'TOOL_ARGS',
      correlationId: ctx.runId,
      tool: call.name || 'unknown'
    })
    const toolMsg: ChatMessage = {
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name || 'unknown',
      content: malformed,
      ok: false
    }
    events.push(
      {
        type: 'tool_start',
        runId: ctx.runId,
        toolCallId: call.id,
        name: call.name || 'unknown',
        summary: 'invalid'
      },
      {
        type: 'tool_result',
        runId: ctx.runId,
        toolCallId: call.id,
        name: call.name || 'unknown',
        summary: 'invalid',
        ok: false,
        content: malformed
      }
    )
    emitToolStart(ctx, events[0]!)
    return { ok: false, events, message: toolMsg }
  }

  const summary = summarizeToolArgs(call.name, call.arguments)
  events.push({
    type: 'tool_start',
    runId: ctx.runId,
    toolCallId: call.id,
    name: call.name,
    summary
  })
  emitToolStart(ctx, events[0]!)

  try {
    // Ask before doing anything: the tool_start event is already out, so the
    // renderer can show the approval card in the row the user is looking at.
    if (ctx.approval) {
      const verdict = await ctx.approval.authorize(call)
      if (!verdict.allowed) {
        const toolMsg: ChatMessage = {
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: verdict.reason,
          ok: false
        }
        events.push({
          type: 'tool_result',
          runId: ctx.runId,
          toolCallId: call.id,
          name: call.name,
          summary: 'denied',
          ok: false,
          content: verdict.reason
        })
        return { ok: false, events, message: toolMsg }
      }
    }

    const result = await executeTool(call.name, call.arguments, ctx.workspace, ctx.signal, {
      runDir: ctx.runDir,
      runId: ctx.runId,
      toolCallId: call.id,
      invokeId: ctx.invokeId,
      depth: 0,
      agentMode: ctx.getAgentMode?.() ?? ctx.agentMode,
      getAgentMode: ctx.getAgentMode,
      setAgentMode: ctx.setAgentMode,
      emitAgentEvent: ctx.emitLiveEvent,
      runEnabledMcpIds: ctx.runEnabledMcpIds,
      mcpToolPolicies: ctx.mcpToolPolicies,
      onProgress: ctx.emitLiveEvent
        ? (update) =>
            ctx.emitLiveEvent?.({
              type: 'subagent_update',
              runId: ctx.runId,
              parentToolCallId: call.id,
              kind: update.kind,
              text: update.text
            })
        : undefined,
      onTerminalOutput: ctx.emitLiveEvent
        ? (chunk) =>
            ctx.emitLiveEvent?.({
              type: 'terminal_output_delta',
              runId: ctx.runId,
              toolCallId: call.id,
              text: chunk.text,
              stream: chunk.stream
            })
        : undefined,
      onSubagentContextUsage: ctx.emitLiveEvent
        ? (usage) =>
            ctx.emitLiveEvent?.({
              type: 'subagent_context_usage',
              runId: ctx.runId,
              parentToolCallId: call.id,
              step: usage.step,
              estimatedTokens: usage.estimatedTokens,
              contextWindow: usage.contextWindow,
              contentWindow: usage.contentWindow,
              model: usage.model
            })
        : undefined
    })
    const content = result.content
    const resultSummary = result.summary || summary
    const toolMsg: ChatMessage = {
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content,
      ok: result.ok
    }
    events.push({
      type: 'tool_result',
      runId: ctx.runId,
      toolCallId: call.id,
      name: call.name,
      summary: resultSummary,
      ok: result.ok,
      content
    })
    if (!result.ok && !result.failureLogged) {
      logger.warn('Tool returned failure', {
        scope: 'agent',
        code: 'TOOL_EXEC',
        correlationId: ctx.runId,
        tool: call.name
      })
    }
    return {
      ok: result.ok,
      events,
      message: toolMsg,
      failureKey:
        !result.ok && isExpectedToolError(content) ? `${call.name}:${resultSummary}` : undefined
    }
  } catch (err) {
    if (isAbortError(err)) {
      const content = abortToolContent(ctx)
      const summary = abortToolSummary(ctx)
      const toolMsg: ChatMessage = {
        role: 'tool',
        toolCallId: call.id,
        toolName: call.name,
        content,
        ok: false
      }
      events.push({
        type: 'tool_result',
        runId: ctx.runId,
        toolCallId: call.id,
        name: call.name,
        summary,
        ok: false,
        content
      })
      return { ok: false, events, message: toolMsg }
    }
    throw err
  }
}

/** Write the settled result to disk once the repeat-failure hint has been applied. */
function persistToolResult(ctx: ToolStepContext, outcome: ToolOutcome): void {
  for (const ev of outcome.events) {
    if (ev.type === 'tool_result') ctx.appendEvent(toolResultEventForPersistence(ev))
  }
}

function abortedToolResult(
  call: ToolCall,
  ctx: ToolStepContext,
  options?: { emitStart?: boolean }
): ToolOutcome {
  const content = abortToolContent(ctx)
  const summary = abortToolSummary(ctx)
  const toolMsg: ChatMessage = {
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content,
    ok: false
  }
  const startEv: AgentEvent = {
    type: 'tool_start',
    runId: ctx.runId,
    toolCallId: call.id,
    name: call.name,
    summary: summarizeToolArgs(call.name, call.arguments)
  }
  const ev: AgentEvent = {
    type: 'tool_result',
    runId: ctx.runId,
    toolCallId: call.id,
    name: call.name,
    summary,
    ok: false,
    content
  }
  const emitStart = options?.emitStart !== false
  if (emitStart) {
    emitToolStart(ctx, startEv)
    return { ok: false, events: [startEv, ev], message: toolMsg }
  }
  return { ok: false, events: [ev], message: toolMsg }
}

async function runParallelBatch(
  calls: ToolCall[],
  ctx: ToolStepContext,
  parallelLimit: number
): Promise<Map<string, ToolOutcome>> {
  const results = new Map<string, ToolOutcome>()
  const startedIds = new Set<string>()
  let index = 0
  const workers = Array.from({ length: Math.min(parallelLimit, calls.length) }, async () => {
    while (index < calls.length) {
      if (ctx.signal.aborted) break
      const i = index++
      const call = calls[i]
      if (!call) break
      startedIds.add(call.id)
      const result = await runSingleTool(call, ctx)
      results.set(call.id, result)
    }
  })
  await Promise.all(workers)
  // After abort, keep settled outcomes; only synthesize abort results for tools
  // that never produced a ToolOutcome. Never re-emit tool_start for started ids.
  if (ctx.signal.aborted) {
    for (const call of calls) {
      const existing = results.get(call.id)
      if (existing) continue
      results.set(
        call.id,
        abortedToolResult(call, ctx, { emitStart: !startedIds.has(call.id) })
      )
    }
  }
  return results
}

/** Execute tool calls with read-only parallelism; preserve call order in output. */
export async function executeStepToolCalls(
  calls: ToolCall[],
  ctx: ToolStepContext
): Promise<{ messages: ChatMessage[]; events: AgentEvent[]; stepToolsOk: boolean }> {
  const messages: ChatMessage[] = []
  const events: AgentEvent[] = []
  let stepToolsOk = true
  // Approval gates individual tools; do not force all reads serial.
  const parallelLimit = ctx.maxParallelReadTools ?? MAX_PARALLEL_READ_TOOLS

  const groups: ToolCall[][] = []
  let batch: ToolCall[] = []

  const batchLimitFor = (name: string): number =>
    name === 'subagent' ? MAX_PARALLEL_SUBAGENTS : parallelLimit

  const flushBatch = (): void => {
    if (batch.length === 0) return
    const limit = batchLimitFor(batch[0]!.name)
    while (batch.length > 0) {
      groups.push(batch.splice(0, Math.min(limit, batch.length)))
    }
  }

  for (const call of calls) {
    if (isParallelSafeTool(call.name)) {
      if (batch.length > 0 && batch[0]!.name !== call.name) {
        flushBatch()
      }
      batch.push(call)
      if (batch.length >= batchLimitFor(call.name)) flushBatch()
    } else {
      flushBatch()
      groups.push([call])
    }
  }
  flushBatch()

  const collect = async (outcome: ToolOutcome): Promise<void> => {
    const final = applyRepeatFailureHint(ctx, outcome)
    // Full output must be durable before the truncated live event can be expanded.
    await ctx.appendMessage(final.message)
    persistToolResult(ctx, final)
    for (const ev of final.events) emitToolResult(ctx, ev)
    messages.push(final.message)
    events.push(...final.events)
    if (!final.ok) stepToolsOk = false
  }

  for (const group of groups) {
    if (ctx.signal.aborted) {
      for (const call of group) await collect(abortedToolResult(call, ctx))
      continue
    }

    const parallel =
      group.length > 1 && group.every((c) => isParallelSafeTool(c.name))
    if (parallel) {
      const batchLimit = batchLimitFor(group[0]!.name)
      const batch = await runParallelBatch(group, ctx, batchLimit)
      for (const call of group) {
        await collect(batch.get(call.id) ?? abortedToolResult(call, ctx))
      }
    } else {
      for (const call of group) {
        if (ctx.signal.aborted) {
          await collect(abortedToolResult(call, ctx))
          continue
        }
        await collect(await runSingleTool(call, ctx))
      }
    }
  }

  return { messages, events, stepToolsOk }
}

export { isMalformedToolCall }
