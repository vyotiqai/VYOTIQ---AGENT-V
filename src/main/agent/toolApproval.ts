import { randomUUID } from 'crypto'
import type {
  ToolApprovalDecision,
  ToolApprovalMode,
  ToolApprovalRequest,
  ToolApprovalResponse
} from '../../shared/ipc'
import { logger } from '../../shared/logger'
import { summarizeToolArgs } from '../../shared/toolSummary'
import { isReadOnlyTool } from './tools/classify'

export type ApprovalSender = (request: ToolApprovalRequest) => void

/** One sender per run: approval prompts belong to the window that started it. */
const senders = new Map<string, ApprovalSender>()
const pending = new Map<
  string,
  { resolve: (decision: ToolApprovalDecision) => void; runId: string }
>()

export function registerApprovalSender(runId: string, sender: ApprovalSender): () => void {
  senders.set(runId, sender)
  return () => {
    if (senders.get(runId) === sender) senders.delete(runId)
  }
}

/** Returns false when the request is unknown, e.g. the run was already cancelled. */
export function resolveToolApproval(response: ToolApprovalResponse): boolean {
  const entry = pending.get(response.requestId)
  if (!entry) return false
  pending.delete(response.requestId)
  entry.resolve(response.decision)
  return true
}

/** Cancelling a run must not leave its approval prompts waiting forever. */
export function cancelPendingApprovals(runId: string): void {
  for (const [requestId, entry] of pending) {
    if (entry.runId !== runId) continue
    pending.delete(requestId)
    entry.resolve('deny')
  }
}

export function isToolGated(
  name: string,
  mode: ToolApprovalMode,
  sessionAllowlist: ReadonlySet<string>,
  workspaceAllowlist: readonly string[]
): boolean {
  if (mode === 'off') return false
  if (sessionAllowlist.has(name)) return false
  if (workspaceAllowlist.includes(name)) return false
  if (mode === 'all') return true
  return !isReadOnlyTool(name)
}

export type AuthorizeResult = { allowed: true } | { allowed: false; reason: string }

export type ToolApprovalGate = {
  authorize(call: { id: string; name: string; arguments: string }): Promise<AuthorizeResult>
}

export type ApprovalGateOptions = {
  runId: string
  mode: ToolApprovalMode
  workspaceAllowlist: readonly string[]
  signal: AbortSignal
  /** Persists an "always allow" choice; omitted in tests and headless runs. */
  persistAlways?: (toolName: string) => void
  /** Overridable so tests can drive the decision without an Electron window. */
  ask?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>
}

function askThroughRenderer(
  request: ToolApprovalRequest,
  signal: AbortSignal
): Promise<ToolApprovalDecision> {
  const sender = senders.get(request.runId)
  if (!sender) {
    logger.warn('Tool approval required but no window is listening', {
      scope: 'agent',
      code: 'TOOL_APPROVAL',
      correlationId: request.runId,
      tool: request.name
    })
    return Promise.resolve('deny')
  }

  return new Promise<ToolApprovalDecision>((resolve) => {
    const settle = (decision: ToolApprovalDecision): void => {
      pending.delete(request.requestId)
      signal.removeEventListener('abort', onAbort)
      resolve(decision)
    }
    function onAbort(): void {
      settle('deny')
    }
    if (signal.aborted) {
      resolve('deny')
      return
    }
    pending.set(request.requestId, { resolve: settle, runId: request.runId })
    signal.addEventListener('abort', onAbort, { once: true })
    sender(request)
  })
}

/**
 * Gate for one run.
 *
 * "Allow for session" lives on this object and dies with the run; "Always allow"
 * is handed to `persistAlways` so it survives into the next one.
 */
export function createApprovalGate(options: ApprovalGateOptions): ToolApprovalGate {
  const sessionAllowlist = new Set<string>()
  const workspaceAllowlist = [...options.workspaceAllowlist]
  const ask = options.ask ?? ((request) => askThroughRenderer(request, options.signal))

  return {
    async authorize(call): Promise<AuthorizeResult> {
      if (!isToolGated(call.name, options.mode, sessionAllowlist, workspaceAllowlist)) {
        return { allowed: true }
      }

      const request: ToolApprovalRequest = {
        requestId: randomUUID(),
        runId: options.runId,
        toolCallId: call.id,
        name: call.name,
        summary: summarizeToolArgs(call.name, call.arguments),
        argsPreview: call.arguments.slice(0, 4000),
        mutating: !isReadOnlyTool(call.name)
      }

      const decision = await ask(request)
      logger.info('Tool approval decision', {
        scope: 'agent',
        correlationId: options.runId,
        tool: call.name,
        decision
      })

      if (decision === 'deny') {
        return {
          allowed: false,
          reason: `The user denied permission to run ${call.name}. Do not retry it; ask what to do instead or continue without it.`
        }
      }
      if (decision === 'session') sessionAllowlist.add(call.name)
      if (decision === 'always') {
        workspaceAllowlist.push(call.name)
        options.persistAlways?.(call.name)
      }
      return { allowed: true }
    }
  }
}

/** Test seam: drop any state left over from a previous run. */
export function resetToolApprovalForTests(): void {
  senders.clear()
  pending.clear()
}
