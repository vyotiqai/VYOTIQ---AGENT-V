import { describe, expect, it } from 'vitest'
import {
  estimateSubagentOverheadTokens,
  prepareSubagentMessages
} from '@main/agent/context/subagentContext'
import type { ChatMessage } from '@shared/ipc'

const model = {
  id: 'test',
  inputModalities: ['text'] as const,
  outputModalities: ['text'] as const,
  supportsTools: true,
  supportsVision: false,
  contextWindow: 10_000
}

describe('prepareSubagentMessages', () => {
  it('trims old tool bodies inside a sub-agent transcript', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'task' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: '1', toolName: 'read', content: 'OLD'.repeat(100) },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '2', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: '2', toolName: 'read', content: 'OLD2'.repeat(100) },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '3', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: '3', toolName: 'read', content: 'NEW'.repeat(100) },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '4', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: '4', toolName: 'read', content: 'NEWER'.repeat(100) }
    ]
    const prepared = prepareSubagentMessages(msgs, model, 500)
    const tools = prepared.filter((m) => m.role === 'tool')
    expect(String(tools[0].content)).toContain('cleared')
    expect(String(tools[tools.length - 1].content)).not.toContain('cleared')
  })

  it('does not share state between independent calls', () => {
    const a: ChatMessage[] = [{ role: 'user', content: 'a' }]
    const b: ChatMessage[] = [{ role: 'user', content: 'b' }]
    const pa = prepareSubagentMessages(a, model, 100)
    const pb = prepareSubagentMessages(b, model, 100)
    expect(pa[0].content).toBe('a')
    expect(pb[0].content).toBe('b')
  })

  it('keeps the first user task when history trim would drop it', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'ANCHOR_TASK' }]
    for (let i = 0; i < 40; i++) {
      msgs.push({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: `t${i}`, name: 'read', arguments: '{}' }]
      })
      msgs.push({
        role: 'tool',
        toolCallId: `t${i}`,
        toolName: 'read',
        content: 'X'.repeat(2_000)
      })
    }
    const prepared = prepareSubagentMessages(msgs, { ...model, contextWindow: 8_000 }, 500)
    expect(prepared[0]?.role).toBe('user')
    expect(prepared[0]?.content).toBe('ANCHOR_TASK')
  })
})

describe('estimateSubagentOverheadTokens', () => {
  it('counts system prompt and tools json', () => {
    const n = estimateSubagentOverheadTokens('system prompt', 42)
    expect(n).toBeGreaterThan(42)
  })
})
