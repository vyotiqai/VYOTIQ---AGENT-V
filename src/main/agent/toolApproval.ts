import { randomUUID } from 'crypto'
import type {
  ToolApprovalDecision,
  ToolApprovalMode,
  ToolApprovalRequest,
  ToolApprovalResponse
} from '../../shared/ipc'
import { isAbortError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { summarizeToolArgs } from '../../shared/toolSummary'
import { isApprovalExemptTool } from './tools/classify'

export type ApprovalSender = (request: ToolApprovalRequest) => void

/** One sender per run: approval prompts belong to the window that started it. */
const senders = new Map<string, ApprovalSender>()
const pending = new Map<
  string,
  {
    resolve: (decision: ToolApprovalDecision) => void
    reject: (err: Error) => void
    runId: string
    invokeId?: number
    request: ToolApprovalRequest
  }
>()

function abortApprovalError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

/**
 * Register (or replace) the window that receives approval prompts for a run.
 * Re-pushes any still-pending approvals so a remounted renderer can show cards.
 */
export function registerApprovalSender(runId: string, sender: ApprovalSender): () => void {
  senders.set(runId, sender)
  for (const entry of pending.values()) {
    if (entry.runId === runId) sender(entry.request)
  }
  return () => {
    if (senders.get(runId) === sender) senders.delete(runId)
  }
}

/** Pending approval payloads still waiting on the user for this run. */
export function listPendingToolApprovals(runId: string): ToolApprovalRequest[] {
  const out: ToolApprovalRequest[] = []
  for (const entry of pending.values()) {
    if (entry.runId === runId) out.push(entry.request)
  }
  return out
}

/** Returns false when the request is unknown, e.g. the run was already cancelled. */
export function resolveToolApproval(response: ToolApprovalResponse): boolean {
  const entry = pending.get(response.requestId)
  if (!entry) return false
  pending.delete(response.requestId)
  entry.resolve(response.decision)
  return true
}

/**
 * Cancelling a run must not leave its approval prompts waiting forever.
 * When `invokeId` is set, only that turn's prompts are cleared — so a prior
 * turn's IPC `finally` cannot auto-abort the active follow-up turn.
 */
export function cancelPendingApprovals(runId: string, invokeId?: number): void {
  for (const [requestId, entry] of pending) {
    if (entry.runId !== runId) continue
    if (invokeId !== undefined && entry.invokeId !== invokeId) continue
    pending.delete(requestId)
    entry.reject(abortApprovalError())
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
  return !isApprovalExemptTool(name)
}

export type AuthorizeResult = { allowed: true } | { allowed: false; reason: string }

export type ToolApprovalGate = {
  authorize(call: { id: string; name: string; arguments: string }): Promise<AuthorizeResult>
}

export type ApprovalGateOptions = {
  runId: string
  /** ChatStart invoke that owns this gate; scopes cancelPendingApprovals. */
  invokeId?: number
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
  signal: AbortSignal,
  invokeId?: number
): Promise<ToolApprovalDecision> {
  const sender = senders.get(request.runId)
  if (!sender) {
    logger.warn('Tool approval required but no window is listening', {
      scope: 'agent',
      code: 'TOOL_APPROVAL',
      correlationId: request.runId,
      tool: request.name
    })
    return Promise.reject(
      new Error(
        'Tool approval required but no app window is listening. Reopen Vyotiq and retry, or turn off tool approval in Settings.'
      )
    )
  }

  return new Promise<ToolApprovalDecision>((resolve, reject) => {
    const settle = (decision: ToolApprovalDecision): void => {
      pending.delete(request.requestId)
      signal.removeEventListener('abort', onAbort)
      resolve(decision)
    }
    function onAbort(): void {
      pending.delete(request.requestId)
      signal.removeEventListener('abort', onAbort)
      reject(abortApprovalError())
    }
    if (signal.aborted) {
      reject(abortApprovalError())
      return
    }
    pending.set(request.requestId, {
      resolve: settle,
      reject,
      runId: request.runId,
      invokeId,
      request
    })
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
  const ask =
    options.ask ??
    ((request) => askThroughRenderer(request, options.signal, options.invokeId))

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
        // True when the tool is not approval-exempt (mutating tools, web_fetch, MCP).
        mutating: !isApprovalExemptTool(call.name)
      }

      const decision = await ask(request).catch((err: unknown) => {
        if (isAbortError(err) || (err instanceof Error && err.name === 'AbortError')) {
          throw err
        }
        const message =
          err instanceof Error
            ? err.message
            : 'Tool approval failed because no app window is listening.'
        return { __denyReason: message } as const
      })
      if (typeof decision === 'object' && decision && '__denyReason' in decision) {
        return { allowed: false, reason: decision.__denyReason }
      }
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

/** Test helper — wipe senders and pending prompts between cases. */
export function resetToolApprovalForTests(): void {
  senders.clear()
  pending.clear()
}
