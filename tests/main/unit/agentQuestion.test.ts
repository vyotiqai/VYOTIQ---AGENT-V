import { describe, expect, it, beforeEach } from 'vitest'
import {
  askQuestionThroughRenderer,
  cancelPendingQuestions,
  listPendingAgentQuestions,
  registerQuestionSender,
  resetAgentQuestionForTests,
  resolveAgentQuestion
} from '@main/agent/agentQuestion'
import type { AgentQuestionRequest } from '@shared/ipc'

const REQUEST: AgentQuestionRequest = {
  requestId: 'req-1',
  runId: 'run-1',
  toolCallId: 'tool-1',
  question: 'Which approach?'
}

describe('agentQuestion', () => {
  beforeEach(() => {
    resetAgentQuestionForTests()
  })

  it('denies when no window is listening rather than hanging', async () => {
    await expect(
      askQuestionThroughRenderer(REQUEST, new AbortController().signal)
    ).rejects.toThrow(/none is listening/i)
  })

  it('rides the renderer round trip', async () => {
    const seen: AgentQuestionRequest[] = []
    registerQuestionSender('run-1', (request) => {
      seen.push(request)
    })

    const answers = askQuestionThroughRenderer(REQUEST, new AbortController().signal)
    await Promise.resolve()
    expect(seen).toHaveLength(1)
    expect(seen[0]!.question).toBe('Which approach?')

    expect(resolveAgentQuestion({ requestId: 'req-1', answers: ['Option A'] })).toBe(true)
    await expect(answers).resolves.toEqual(['Option A'])
  })

  it('releases a waiting prompt when the run is cancelled', async () => {
    registerQuestionSender('run-1', () => {})
    const controller = new AbortController()
    const pending = askQuestionThroughRenderer(REQUEST, controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('releases prompts left over when a run ends', async () => {
    registerQuestionSender('run-1', () => {})
    const pending = askQuestionThroughRenderer(REQUEST, new AbortController().signal)
    await Promise.resolve()
    cancelPendingQuestions('run-1')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('lists pending questions for remount restore', async () => {
    const seen: AgentQuestionRequest[] = []
    registerQuestionSender('run-1', (request) => {
      seen.push(request)
    })
    const pending = askQuestionThroughRenderer(REQUEST, new AbortController().signal)
    await Promise.resolve()
    expect(listPendingAgentQuestions('run-1')).toEqual([REQUEST])
    expect(listPendingAgentQuestions('other')).toEqual([])

    // Re-registering re-pushes still-pending questions.
    registerQuestionSender('run-1', (request) => {
      seen.push(request)
    })
    expect(seen).toHaveLength(2)

    expect(resolveAgentQuestion({ requestId: 'req-1', answers: ['yes'] })).toBe(true)
    await expect(pending).resolves.toEqual(['yes'])
    expect(listPendingAgentQuestions('run-1')).toEqual([])
  })
})
