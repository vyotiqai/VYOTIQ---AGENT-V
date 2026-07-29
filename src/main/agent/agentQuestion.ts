import type { AgentQuestionRequest, AgentQuestionResponse } from '../../shared/ipc'
import { isAbortError } from '../../shared/errors'
import { logger } from '../../shared/logger'

export type QuestionSender = (request: AgentQuestionRequest) => void

/** One sender per run: question prompts belong to the window that started it. */
const senders = new Map<string, QuestionSender>()
const pending = new Map<
  string,
  {
    resolve: (answers: string[]) => void
    reject: (err: Error) => void
    runId: string
    invokeId?: number
  }
>()

function abortQuestionError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

export function registerQuestionSender(runId: string, sender: QuestionSender): () => void {
  senders.set(runId, sender)
  return () => {
    if (senders.get(runId) === sender) senders.delete(runId)
  }
}

/** Returns false when the request is unknown, e.g. the run was already cancelled. */
export function resolveAgentQuestion(response: AgentQuestionResponse): boolean {
  const entry = pending.get(response.requestId)
  if (!entry) return false
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
    const settle = (answers: string[]): void => {
      pending.delete(request.requestId)
      signal.removeEventListener('abort', onAbort)
      resolve(answers)
    }
    function onAbort(): void {
      pending.delete(request.requestId)
      signal.removeEventListener('abort', onAbort)
      reject(abortQuestionError())
    }
    if (signal.aborted) {
      reject(abortQuestionError())
      return
    }
    pending.set(request.requestId, {
      resolve: settle,
      reject,
      runId: request.runId,
      invokeId
    })
    signal.addEventListener('abort', onAbort, { once: true })
    sender(request)
  })
}

/** Test helper — wipe senders and pending prompts between cases. */
export function resetAgentQuestionForTests(): void {
  senders.clear()
  pending.clear()
}
