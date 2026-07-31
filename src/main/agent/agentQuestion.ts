import type { AgentQuestionRequest, AgentQuestionResponse } from '../../shared/ipc'
import { isAbortError } from '../../shared/errors'
import { logger } from '../../shared/logger'

export type QuestionSender = (request: AgentQuestionRequest) => void

/** Default wait for user answers before auto-denying (15 minutes). */
export const AGENT_QUESTION_TIMEOUT_MS = 900_000

/** One sender per run: question prompts belong to the window that started it. */
const senders = new Map<string, QuestionSender>()
const pending = new Map<
  string,
  {
    resolve: (answers: string[]) => void
    reject: (err: Error) => void
    runId: string
    invokeId?: number
    request: AgentQuestionRequest
  }
>()

function abortQuestionError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

/**
 * Register (or replace) the window that receives question prompts for a run.
 * Re-pushes any still-pending questions so a remounted renderer can show cards.
 */
export function registerQuestionSender(runId: string, sender: QuestionSender): () => void {
  senders.set(runId, sender)
  for (const entry of pending.values()) {
    if (entry.runId === runId) sender(entry.request)
  }
  return () => {
    if (senders.get(runId) === sender) senders.delete(runId)
  }
}

/** Pending question payloads still waiting on the user for this run. */
export function listPendingAgentQuestions(runId: string): AgentQuestionRequest[] {
  const out: AgentQuestionRequest[] = []
  for (const entry of pending.values()) {
    if (entry.runId === runId) out.push(entry.request)
  }
  return out
}

/** Returns false when the request is unknown or runId does not match. */
export function resolveAgentQuestion(response: AgentQuestionResponse): boolean {
  const entry = pending.get(response.requestId)
  if (!entry) return false
  if (entry.runId !== response.runId) return false
  pending.delete(response.requestId)
  entry.resolve(response.answers)
  return true
}

/**
 * Cancelling a run must not leave question prompts waiting forever.
 * When `invokeId` is set, only that turn's prompts are cleared.
 */
export function cancelPendingQuestions(runId: string, invokeId?: number): void {
  for (const [requestId, entry] of pending) {
    if (entry.runId !== runId) continue
    if (invokeId !== undefined && entry.invokeId !== invokeId) continue
    pending.delete(requestId)
    entry.reject(abortQuestionError())
  }
}

export function askQuestionThroughRenderer(
  request: AgentQuestionRequest,
  signal: AbortSignal,
  invokeId?: number
): Promise<string[]> {
  const sender = senders.get(request.runId)
  if (!sender) {
    logger.warn('Agent question required but no window is listening', {
      scope: 'agent',
      code: 'AGENT_QUESTION',
      correlationId: request.runId
    })
    return Promise.reject(
      new Error(
        'ask_question requires an app window but none is listening. Reopen Vyotiq and retry.'
      )
    )
  }

  return new Promise<string[]>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const clearWaiters = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      signal.removeEventListener('abort', onAbort)
    }
    const settle = (answers: string[]): void => {
      pending.delete(request.requestId)
      clearWaiters()
      resolve(answers)
    }
    function onAbort(): void {
      pending.delete(request.requestId)
      clearWaiters()
      reject(abortQuestionError())
    }
    function onTimeout(): void {
      pending.delete(request.requestId)
      clearWaiters()
      reject(new Error('Question timed out without a response. Continue without waiting, or ask again.'))
    }
    if (signal.aborted) {
      reject(abortQuestionError())
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
    timeoutId = setTimeout(onTimeout, AGENT_QUESTION_TIMEOUT_MS)
    sender(request)
  })
}

/** Test helper — wipe senders and pending prompts between cases. */
export function resetAgentQuestionForTests(): void {
  senders.clear()
  pending.clear()
}
