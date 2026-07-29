import { describe, expect, it } from 'vitest'
import { executeTool } from '@main/agent/tools'

describe('ask_question tool', () => {
  it('fails without a question sender', async () => {
    const result = await executeTool(
      'ask_question',
      JSON.stringify({ question: 'Continue?' }),
      '/ws',
      new AbortController().signal,
      { runId: 'run-1', toolCallId: 'tc-1' }
    )
    expect(result.ok).toBe(false)
    expect(result.content).toMatch(/none is listening/i)
  })

  it('returns summarized answers from a mock ask', async () => {
    const result = await executeTool(
      'ask_question',
      JSON.stringify({ question: 'Pick one', options: ['A', 'B'] }),
      '/ws',
      new AbortController().signal,
      {
        runId: 'run-1',
        toolCallId: 'tc-1',
        askQuestion: async () => ['A']
      }
    )
    expect(result.ok).toBe(true)
    expect(result.content).toBe('User answered: A')
  })
})
