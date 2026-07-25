import type { AgentEvent, ChatMessage } from '../../shared/ipc'
import { isAbortError, isExpectedToolError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { summarizeToolArgs } from '../../shared/toolSummary'
import { toolResultEventForPersistence } from '../../shared/utils/toolResultIpc'
import type { ToolCall } from './providers/types'
import { executeTool } from '@main/agent/tools'
import { isReadOnlyTool, MAX_PARALLEL_READ_TOOLS } from './tools/classify'

export type ToolStepContext = {
  runId: string
  runDir: string
  workspace: string
  signal: AbortSignal
  appendMessage: (msg: ChatMessage) => void
  appendEvent: (ev: AgentEvent) => void
  /** Per-run failed tool keys (`tool:summary`) for repeat-failure hints. */
  failedToolKeys?: Map<string, number>
  /** Override parallel read batch size (e.g. 1 after consecutive failure steps). */
  maxParallelReadTools?: number
}

function repeatFailureHint(
  ctx: ToolStepContext,
  call: ToolCall,
  summary: string,
  content: string,
  ok: boolean
): string {
  if (ok || !ctx.failedToolKeys || !isExpectedToolError(content)) return content
  const key = `${call.name}:${summary}`
  const count = (ctx.failedToolKeys.get(key) ?? 0) + 1
  ctx.failedToolKeys.set(key, count)
  if (count < 2) return content
  return [
    `[Repeated failure #${count} for ${summary} — stop guessing paths; read README/manifests, then use search or dir.]`,
    content
  ].join('\n')
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

async function runSingleTool(
  call: ToolCall,
  ctx: ToolStepContext
): Promise<{
  ok: boolean
  events: AgentEvent[]
  message: ChatMessage
}> {
  const events: AgentEvent[] = []
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
      content: malformed
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
    ctx.appendEvent(events[0]!)
    ctx.appendEvent(toolResultEventForPersistence(events[1]!))
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
  ctx.appendEvent(events[0])

  try {
    const result = await executeTool(call.name, call.arguments, ctx.workspace, ctx.signal)
    const content = repeatFailureHint(ctx, call, result.summary || summary, result.content, result.ok)
    const toolMsg: ChatMessage = {
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content
    }
    events.push({
      type: 'tool_result',
      runId: ctx.runId,
      toolCallId: call.id,
      name: call.name,
      summary: result.summary || summary,
      ok: result.ok,
      content
    })
    ctx.appendEvent(toolResultEventForPersistence(events[1]!))
    if (!result.ok && !result.failureLogged) {
      logger.warn('Tool returned failure', {
        scope: 'agent',
        code: 'TOOL_EXEC',
        correlationId: ctx.runId,
        tool: call.name
      })
    }
    return { ok: result.ok, events, message: toolMsg }
  } catch (err) {
    if (isAbortError(err)) {
      const toolMsg: ChatMessage = {
        role: 'tool',
        toolCallId: call.id,
        toolName: call.name,
        content: 'Cancelled'
      }
      events.push({
        type: 'tool_result',
        runId: ctx.runId,
        toolCallId: call.id,
        name: call.name,
        summary: 'cancelled',
        ok: false,
        content: 'Cancelled'
      })
      ctx.appendEvent(toolResultEventForPersistence(events[events.length - 1]!))
      return { ok: false, events, message: toolMsg }
    }
    throw err
  }
}

function cancelledToolResult(call: ToolCall, ctx: ToolStepContext): {
  ok: boolean
  events: AgentEvent[]
  message: ChatMessage
} {
  const toolMsg: ChatMessage = {
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: 'Cancelled'
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
    summary: 'cancelled',
    ok: false,
    content: 'Cancelled'
  }
  ctx.appendEvent(startEv)
  ctx.appendEvent(toolResultEventForPersistence(ev))
  return { ok: false, events: [startEv, ev], message: toolMsg }
}

async function runParallelBatch(
  calls: ToolCall[],
  ctx: ToolStepContext,
  parallelLimit: number
): Promise<Map<string, { ok: boolean; events: AgentEvent[]; message: ChatMessage }>> {
  const results = new Map<string, { ok: boolean; events: AgentEvent[]; message: ChatMessage }>()
  let index = 0
  const workers = Array.from({ length: Math.min(parallelLimit, calls.length) }, async () => {
    while (index < calls.length) {
      if (ctx.signal.aborted) break
      const i = index++
      const call = calls[i]
      if (!call) break
      const result = await runSingleTool(call, ctx)
      results.set(call.id, result)
    }
  })
  await Promise.all(workers)
  for (const call of calls) {
    if (!results.has(call.id) && ctx.signal.aborted) {
      results.set(call.id, cancelledToolResult(call, ctx))
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
  const parallelLimit = ctx.maxParallelReadTools ?? MAX_PARALLEL_READ_TOOLS

  const groups: ToolCall[][] = []
  let readBatch: ToolCall[] = []

  const flushReadBatch = (): void => {
    while (readBatch.length > 0) {
      groups.push(readBatch.splice(0, parallelLimit))
    }
  }

  for (const call of calls) {
    if (isReadOnlyTool(call.name)) {
      readBatch.push(call)
      if (readBatch.length >= parallelLimit) flushReadBatch()
    } else {
      flushReadBatch()
      groups.push([call])
    }
  }
  flushReadBatch()

  for (const group of groups) {
    if (ctx.signal.aborted) {
      for (const call of group) {
        const cancelled = cancelledToolResult(call, ctx)
        messages.push(cancelled.message)
        events.push(...cancelled.events)
        stepToolsOk = false
      }
      continue
    }

    const parallel = group.length > 1 && group.every((c) => isReadOnlyTool(c.name))
    if (parallel) {
      const batch = await runParallelBatch(group, ctx, parallelLimit)
      for (const call of group) {
        const result = batch.get(call.id) ?? cancelledToolResult(call, ctx)
        messages.push(result.message)
        events.push(...result.events)
        if (!result.ok) stepToolsOk = false
      }
    } else {
      for (const call of group) {
        if (ctx.signal.aborted) {
          const cancelled = cancelledToolResult(call, ctx)
          messages.push(cancelled.message)
          events.push(...cancelled.events)
          stepToolsOk = false
          continue
        }
        const result = await runSingleTool(call, ctx)
        messages.push(result.message)
        events.push(...result.events)
        if (!result.ok) stepToolsOk = false
      }
    }
  }

  return { messages, events, stepToolsOk }
}

export { isMalformedToolCall }
