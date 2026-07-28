import { describe, expect, it } from 'vitest'
import { allocateBudget, contentWindow, contextWindowFor, effectiveWindow } from '@main/agent/context/budget'
import { estimateTextTokens, estimateMessagesTokens } from '@main/agent/context/estimate'
import { trimToolResults } from '@main/agent/context/toolTrim'
import { preserveRecentMessages } from '@main/agent/context/compact'
import { dropOldestTurn, trimHistoryToBudget } from '@main/agent/context/historyTrim'
import { anthropicNativeOptions } from '@main/agent/context/anthropicContext'
import type { ChatMessage } from '@shared/ipc'

describe('context budget + trim', () => {
  it('allocates budget layers totaling ~100%', () => {
    const model = {
      id: 'x',
      inputModalities: ['text'] as const,
      outputModalities: ['text'] as const,
      supportsTools: true,
      supportsVision: false,
      contextWindow: 100_000
    }
    expect(contextWindowFor(model)).toBe(100_000)
    const b = allocateBudget(model)
    expect(b.system + b.tools + b.memoryWorkspace + b.history + b.buffer).toBe(100_000)
  })

  it('contentWindow equals non-buffer shares (does not double-subtract buffer)', () => {
    const model = {
      id: 'x',
      inputModalities: ['text'] as const,
      outputModalities: ['text'] as const,
      supportsTools: true,
      supportsVision: false,
      contextWindow: 100_000
    }
    expect(contentWindow(model)).toBe(effectiveWindow(model))
    expect(contentWindow(model)).toBe(85_000)
  })

  it('estimates tokens heuristically', () => {
    expect(estimateTextTokens('abcd')).toBe(1)
    expect(
      estimateMessagesTokens([{ role: 'user', content: 'hello world!!' }])
    ).toBeGreaterThan(0)
  })

  it('clears old tool bodies and keeps last N', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '1', toolName: 'read', content: 'OLD1'.repeat(100) },
      { role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '2', toolName: 'read', content: 'OLD2'.repeat(100) },
      { role: 'assistant', content: '', toolCalls: [{ id: '3', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '3', toolName: 'read', content: 'NEW'.repeat(100) },
      { role: 'assistant', content: '', toolCalls: [{ id: '4', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '4', toolName: 'read', content: 'NEWER'.repeat(100) }
    ]
    const trimmed = trimToolResults(msgs, 3)
    const tools = trimmed.filter((m) => m.role === 'tool')
    expect(tools[0].content).toContain('cleared')
    expect(String(tools[1].content)).not.toContain('cleared')
  })

  it('preserves subagent reports from clearing and char trim', () => {
    const long = 'x'.repeat(20_000)
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '1', toolName: 'read', content: 'OLD'.repeat(100) },
      { role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '2', toolName: 'read', content: 'OLD2'.repeat(100) },
      { role: 'assistant', content: '', toolCalls: [{ id: '3', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '3', toolName: 'read', content: 'NEW'.repeat(100) },
      { role: 'assistant', content: '', toolCalls: [{ id: '4', name: 'subagent', arguments: '{}' }] },
      { role: 'tool', toolCallId: '4', toolName: 'subagent', content: long },
      { role: 'assistant', content: '', toolCalls: [{ id: '5', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '5', toolName: 'read', content: 'NEWER'.repeat(100) }
    ]
    const trimmed = trimToolResults(msgs, 3)
    const subagent = trimmed.find((m) => m.role === 'tool' && m.toolName === 'subagent')
    expect(subagent?.content).toBe(long)
  })

  it('preserves recent user turns', () => {
    const msgs: ChatMessage[] = []
    for (let i = 0; i < 20; i++) {
      msgs.push({ role: 'user', content: `u${i}` })
      msgs.push({ role: 'assistant', content: `a${i}` })
    }
    const kept = preserveRecentMessages(msgs, 3)
    expect(kept.some((m) => m.content === 'u17')).toBe(true)
    expect(kept.some((m) => m.content === 'u0')).toBe(false)
  })

  it('drops oldest turn without orphaning tool results', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'old' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'file' },
      { role: 'assistant', content: 'done old' },
      { role: 'user', content: 'new' },
      { role: 'assistant', content: 'ok' }
    ]
    const dropped = dropOldestTurn(msgs)
    expect(dropped[0]).toMatchObject({ role: 'user', content: 'new' })
    expect(dropped.some((m) => m.role === 'tool')).toBe(false)
  })

  it('trims history to budget without starting on a tool message', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'u0 ' + 'x'.repeat(4000) },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'y'.repeat(4000) },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' }
    ]
    const trimmed = trimHistoryToBudget(msgs, 50)
    expect(trimmed[0].role).not.toBe('tool')
    expect(trimmed.some((m) => m.role === 'user' && m.content === 'u1')).toBe(true)
  })

  it('scales anthropic compact trigger to model context window', () => {
    const opts = anthropicNativeOptions('anthropic', {
      id: 'claude-haiku-4-5',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      supportsVision: true,
      contextWindow: 32_000
    })
    expect(opts.compactTriggerTokens).toBeGreaterThanOrEqual(8_000)
    expect(opts.compactTriggerTokens).toBeLessThan(50_000)
    expect(opts.clearToolUsesKeep).toBe(3)
  })

  it('strips images when model lacks vision', async () => {
    const { stripImagesFromMessages } = await import('@main/agent/context/stripImages')
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see' },
          { type: 'image_url', url: 'data:image/png;base64,aa' }
        ]
      }
    ]
    const stripped = stripImagesFromMessages(msgs)
    expect(typeof stripped[0].content).toBe('string')
    expect(String(stripped[0].content)).toContain('omitted')
    expect(String(stripped[0].content)).toContain('see')
  })
})
