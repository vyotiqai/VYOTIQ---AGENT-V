import { describe, expect, it } from 'vitest'
import { allocateBudget, contentWindow, contextWindowFor, effectiveWindow } from '@main/agent/context/budget'
import { estimateTextTokens, estimateMessagesTokens } from '@main/agent/context/estimate'
import { trimToolResults } from '@main/agent/context/toolTrim'
import { preserveRecentMessages } from '@main/agent/context/compact'
import {
  applyFoldedMessagesWatermark,
  dropOldestTurn,
  stripLeadingOrphanToolMessages,
  trimHistoryToBudget
} from '@main/agent/context/historyTrim'
import { anthropicNativeOptions } from '@main/agent/context/anthropicContext'
import { stripThinkingForCompaction } from '@main/agent/context/assemble'
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

  it('caps kept tool bodies at 8k chars (and subagent at 6k when trimmed)', () => {
    const fat = 'z'.repeat(20_000)
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '1', toolName: 'read', content: fat },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '2', name: 'subagent', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: '2', toolName: 'subagent', content: fat }
    ]
    const kept = trimToolResults(msgs, 2)
    const read = kept.find((m) => m.role === 'tool' && m.toolName === 'read')
    expect(String(read?.content).length).toBeLessThanOrEqual(8_050)
    expect(String(read?.content)).toContain('[truncated]')
    const subKept = trimToolResults(msgs, 2, { trimSubagent: true })
    const sub = subKept.find((m) => m.role === 'tool' && m.toolName === 'subagent')
    expect(String(sub?.content).length).toBeLessThanOrEqual(6_050)
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

  it('can trim subagent results under overflow pressure', () => {
    const long = 'x'.repeat(20_000)
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'subagent', arguments: '{}' }] },
      { role: 'tool', toolCallId: '1', toolName: 'subagent', content: long },
      { role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '2', toolName: 'read', content: 'kept' }
    ]
    const trimmed = trimToolResults(msgs, 1, { trimSubagent: true })
    const subagent = trimmed.find((m) => m.role === 'tool' && m.toolName === 'subagent')
    expect(String(subagent?.content)).toContain('cleared')
  })

  it('preserves Persisted report path when stubbing subagent under overflow', () => {
    const report =
      'Persisted report: subagents/abcd1234/report.md (re-read with `read` after compaction).\n\n' +
      'x'.repeat(20_000)
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'subagent', arguments: '{}' }] },
      { role: 'tool', toolCallId: '1', toolName: 'subagent', content: report },
      { role: 'assistant', content: '', toolCalls: [{ id: '2', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: '2', toolName: 'read', content: 'kept' }
    ]
    const trimmed = trimToolResults(msgs, 1, { trimSubagent: true })
    const subagent = trimmed.find((m) => m.role === 'tool' && m.toolName === 'subagent')
    const content = String(subagent?.content)
    expect(content).toContain('Persisted report: subagents/abcd1234/report.md')
    expect(content).toContain('cleared')
    expect(content).not.toContain('x'.repeat(100))
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

  it('stripLeadingOrphanToolMessages removes a sole orphan tool (foldedMessages=2 case)', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'u' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'file' }
    ]
    const applied = applyFoldedMessagesWatermark(msgs, 2)
    expect(applied.messages[0].role).not.toBe('tool')
    expect(applied.messages.some((m) => m.role === 'assistant')).toBe(true)
  })

  it('preserveRecentMessages never returns a leading orphan tool', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'u0' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'x'.repeat(8000) }
    ]
    const model = {
      id: 'x',
      inputModalities: ['text'] as const,
      outputModalities: ['text'] as const,
      supportsTools: true,
      supportsVision: false,
      contextWindow: 1000
    }
    const kept = preserveRecentMessages(msgs, 5, 200, model)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept[0].role).not.toBe('tool')
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
    expect(opts.clearToolUsesKeep).toBe(2)
    expect(opts.clearToolUsesTriggerTokens).toBeGreaterThanOrEqual(32_000)
    expect(opts.clearToolUsesAtLeastTokens).toBe(5_000)
    expect(opts.clearToolUsesExcludeTools).toEqual(
      expect.arrayContaining(['read', 'memory_read', 'todo_write', 'ask_question'])
    )
  })

  it('overflow strip drops reasoningState as well as thinking', () => {
    const stripped = stripThinkingForCompaction([
      {
        role: 'assistant',
        content: 'ok',
        thinking: 'ui only',
        reasoningState: { kind: 'openai_compat', reasoningContent: 'wire replay' }
      },
      { role: 'user', content: 'hi' }
    ])
    expect(stripped[0]).toEqual({ role: 'assistant', content: 'ok' })
    expect(stripped[1]).toEqual({ role: 'user', content: 'hi' })
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

  it('strips audio and native files when wire caps disallow them', async () => {
    const { stripUnsupportedModalitiesFromMessages } = await import(
      '@main/agent/context/stripImages'
    )
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'audio', url: 'data:audio/wav;base64,QQ==' },
          {
            type: 'file_native',
            name: 'a.pdf',
            mime: 'application/pdf',
            data: 'AAAA'
          }
        ]
      }
    ]
    const stripped = stripUnsupportedModalitiesFromMessages(msgs, {
      image: true,
      audio: false,
      fileNative: false
    })
    const text = typeof stripped[0]!.content === 'string'
      ? stripped[0]!.content
      : JSON.stringify(stripped[0]!.content)
    expect(text).toContain('audio omitted')
    expect(text).toContain('file omitted')
    expect(text).toContain('hi')
  })
})
