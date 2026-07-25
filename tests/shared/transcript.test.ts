import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/ipc'
import { inferToolStatus, messagesToUiItems, applyEventTimestamps, isMeaningfulThinking, duplicatesReasoning } from '@shared/transcript'

describe('messagesToUiItems', () => {
  it('rebuilds user, assistant, and tool rows in order', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'read a.ts' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'file body' },
      { role: 'assistant', content: 'done' }
    ]

    const items = messagesToUiItems(messages)
    expect(items.map((i) => i.kind)).toEqual(['message', 'tool', 'message'])
    const tool = items[1]
    expect(tool.kind).toBe('tool')
    if (tool.kind === 'tool') {
      expect(tool.tool.name).toBe('read')
      expect(tool.tool.summary).toBe('a.ts')
      expect(tool.tool.status).toBe('done')
      expect(tool.tool.content).toBe('file body')
    }
  })

  it('includes thinking on assistant messages', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'answer', thinking: 'planned approach' }
    ]
    const items = messagesToUiItems(messages)
    expect(items).toHaveLength(1)
    if (items[0].kind === 'message') {
      expect(items[0].thinking).toBe('planned approach')
    }
  })

  it('keeps each step reasoning above the calls it explains', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'refactor' },
      {
        role: 'assistant',
        content: '',
        thinking: 'First I read the file.',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'body' },
      {
        role: 'assistant',
        content: '',
        thinking: 'Now I edit it.',
        toolCalls: [{ id: 'c2', name: 'edit', arguments: '{"path":"a.ts"}' }]
      },
      { role: 'tool', toolCallId: 'c2', toolName: 'edit', content: 'ok' },
      { role: 'assistant', content: 'Refactored.' }
    ]

    const items = messagesToUiItems(messages)
    expect(items.map((i) => i.kind)).toEqual([
      'message',
      'message',
      'tool',
      'message',
      'tool',
      'message'
    ])
    expect(items[1]).toMatchObject({ thinking: 'First I read the file.', content: '' })
    expect(items[3]).toMatchObject({ thinking: 'Now I edit it.', content: '' })
    expect(items[5]).toMatchObject({ content: 'Refactored.' })
  })

  it('marks empty tool results as done when replaying a run', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"empty.txt"}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: '' }
    ]
    const items = messagesToUiItems(messages)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('tool')
    if (items[0].kind === 'tool') {
      expect(items[0].tool.status).toBe('done')
    }
  })

  it('skips empty assistant bubble when only tool calls', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'search', arguments: '{"query":"foo"}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'search', content: 'hits' }
    ]
    const items = messagesToUiItems(messages)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('tool')
  })

  it('places assistant text before tools in the same turn', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'read file' },
      {
        role: 'assistant',
        content: 'I will read that file for you.',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'file body' }
    ]

    const items = messagesToUiItems(messages)
    expect(items.map((i) => i.kind)).toEqual(['message', 'message', 'tool'])
    expect(items[0]).toMatchObject({ kind: 'message', role: 'user' })
    expect(items[1]).toMatchObject({
      kind: 'message',
      role: 'assistant',
      content: 'I will read that file for you.'
    })
  })

  it('passes image URLs through user messages', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'image_url', url: 'data:image/png;base64,abc' }
        ]
      }
    ]

    const items = messagesToUiItems(messages)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'message',
      role: 'user',
      content: 'look at this',
      images: ['data:image/png;base64,abc']
    })
  })

  it('uses stable message ids across rebuilds', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ]
    const a = messagesToUiItems(messages)
    const b = messagesToUiItems(messages)
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id))
    expect(a[0]?.id).toBe('user-0')
    expect(a[1]?.id).toBe('assistant-1')
  })

  it('emits running tool rows for unresolved toolCalls', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c-pending', name: 'read', arguments: '{"path":"a.ts"}' }]
      }
    ]
    const items = messagesToUiItems(messages)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'tool',
      id: 'c-pending',
      tool: { name: 'read', status: 'running', summary: 'a.ts' }
    })
  })

  it('stores raw JSON in argsPreview when rebuilding from messages', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'Reading.',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'body' }
    ]
    const items = messagesToUiItems(messages)
    const tool = items.find((i) => i.kind === 'tool')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind === 'tool') {
      expect(tool.tool.summary).toBe('a.ts')
      expect(tool.tool.argsPreview).toBe('{"path":"a.ts"}')
    }
  })

  it('interleaves multi-step assistant text and tools instead of stacking tools at the end', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'analyze' },
      {
        role: 'assistant',
        content: 'Reading configs.',
        toolCalls: [
          { id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' },
          { id: 'c2', name: 'read', arguments: '{"path":"b.ts"}' }
        ]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'a' },
      { role: 'tool', toolCallId: 'c2', toolName: 'read', content: 'b' },
      {
        role: 'assistant',
        content: 'Exploring sources.',
        toolCalls: [{ id: 'c3', name: 'search', arguments: '{"query":".kt"}' }]
      },
      { role: 'tool', toolCallId: 'c3', toolName: 'search', content: 'hits' }
    ]
    const items = messagesToUiItems(messages)
    expect(items.map((i) => i.kind)).toEqual([
      'message',
      'message',
      'tool',
      'tool',
      'message',
      'tool'
    ])
    expect(items[1]).toMatchObject({ content: 'Reading configs.' })
    expect(items[2]).toMatchObject({ id: 'c1', tool: { status: 'done' } })
    expect(items[3]).toMatchObject({ id: 'c2', tool: { status: 'done' } })
    expect(items[4]).toMatchObject({ content: 'Exploring sources.' })
    expect(items[5]).toMatchObject({ id: 'c3', tool: { status: 'done' } })
  })
})

describe('transcript display helpers', () => {
  it('treats placeholder punctuation as non-meaningful thinking', () => {
    expect(isMeaningfulThinking('.')).toBe(false)
    expect(isMeaningfulThinking('…')).toBe(false)
    expect(isMeaningfulThinking('planned approach')).toBe(true)
  })

  it('keeps narration between tool batches, streaming or not', () => {
    const narration = {
      kind: 'message',
      id: 'a2',
      role: 'assistant',
      content: 'Continuing the audit in the router next.'
    } as const

    expect(duplicatesReasoning(narration)).toBe(false)
    expect(duplicatesReasoning({ ...narration, streaming: true })).toBe(false)
  })

  it('hides text a reasoning model already said in its thinking', () => {
    const passage = 'The router builds its table before the first request arrives.'

    expect(
      duplicatesReasoning({
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        content: passage,
        thinking: `Let me check.\n\n${passage}`
      })
    ).toBe(true)
  })

  it('does not treat a shared phrase as a duplicate', () => {
    expect(
      duplicatesReasoning({
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        content: 'Done.',
        thinking: 'Done. Now I will summarize what changed for the reader.'
      })
    ).toBe(false)
  })
})

describe('inferToolStatus', () => {
  it('marks failures from content heuristics', () => {
    expect(inferToolStatus('Unknown tool: foo')).toBe('fail')
    expect(inferToolStatus('exit_code: 1\nstderr')).toBe('fail')
    expect(inferToolStatus('ok output')).toBe('done')
  })

  it('treats empty tool output as success when replaying history', () => {
    expect(inferToolStatus('')).toBe('done')
    expect(inferToolStatus('Cancelled')).toBe('fail')
    expect(inferToolStatus('Failed to parse tool arguments')).toBe('fail')
    expect(inferToolStatus('invalid args for read')).toBe('fail')
    expect(inferToolStatus('exit_code: 0')).toBe('done')
  })

  it('prefers explicit ok flag over content heuristics', () => {
    expect(inferToolStatus('exit_code: 1\nstderr', true)).toBe('done')
    expect(inferToolStatus('ok output', false)).toBe('fail')
  })
})

describe('applyEventTimestamps', () => {
  it('attaches tool_start timestamps to tool rows in order', () => {
    const items = messagesToUiItems([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'ok' }
    ])
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:00.000Z',
        event: {
          type: 'tool_start',
          runId: 'r1',
          toolCallId: 'c1',
          name: 'read',
          summary: 'file'
        }
      }
    ])
    const tool = enriched.find((i) => i.kind === 'tool')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind === 'tool') {
      expect(tool.at).toBe('2026-07-24T12:00:00.000Z')
    }
  })

  it('reconstructs group timing and ok status from persisted events', () => {
    const items = messagesToUiItems([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'fail output' }
    ])
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:00.000Z',
        event: {
          type: 'tool_start',
          runId: 'r1',
          toolCallId: 'c1',
          name: 'read',
          summary: 'a.ts'
        }
      },
      {
        at: '2026-07-24T12:00:02.000Z',
        event: {
          type: 'tool_result',
          runId: 'r1',
          toolCallId: 'c1',
          name: 'read',
          summary: 'a.ts',
          ok: false,
          content: 'fail output'
        }
      }
    ])
    const tool = enriched.find((i) => i.kind === 'tool')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind === 'tool') {
      expect(tool.tool.status).toBe('fail')
      expect(tool.groupTiming?.startedAt).toBe(new Date('2026-07-24T12:00:00.000Z').getTime())
      expect(tool.groupTiming?.endedAt).toBe(new Date('2026-07-24T12:00:02.000Z').getTime())
    }
  })

  it('matches tool_start timestamps by toolCallId, not row order', () => {
    const items = messagesToUiItems([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'c1', name: 'read', arguments: '{}' },
          { id: 'c2', name: 'search', arguments: '{}' }
        ]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'a' },
      { role: 'tool', toolCallId: 'c2', toolName: 'search', content: 'b' }
    ])
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:05.000Z',
        event: {
          type: 'status',
          runId: 'r1',
          status: 'running'
        }
      },
      {
        at: '2026-07-24T12:00:10.000Z',
        event: {
          type: 'tool_start',
          runId: 'r1',
          toolCallId: 'c2',
          name: 'search',
          summary: 'query'
        }
      },
      {
        at: '2026-07-24T12:00:00.000Z',
        event: {
          type: 'tool_start',
          runId: 'r1',
          toolCallId: 'c1',
          name: 'read',
          summary: 'a.ts'
        }
      }
    ])
    const tools = enriched.filter((i) => i.kind === 'tool')
    expect(tools[0]?.kind).toBe('tool')
    expect(tools[1]?.kind).toBe('tool')
    if (tools[0]?.kind === 'tool' && tools[1]?.kind === 'tool') {
      expect(tools[0].at).toBe('2026-07-24T12:00:00.000Z')
      expect(tools[1].at).toBe('2026-07-24T12:00:10.000Z')
    }
  })

  it('attaches user and assistant message timestamps from run events', () => {
    const items = messagesToUiItems([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' }
    ])
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:00.000Z',
        event: { type: 'status', runId: 'r1', status: 'running' }
      },
      {
        at: '2026-07-24T12:00:05.000Z',
        event: { type: 'status', runId: 'r1', status: 'done' }
      }
    ])
    const user = enriched.find((i) => i.kind === 'message' && i.role === 'user')
    const assistant = enriched.find((i) => i.kind === 'message' && i.role === 'assistant')
    expect(user?.kind).toBe('message')
    expect(assistant?.kind).toBe('message')
    if (user?.kind === 'message') expect(user.at).toBe('2026-07-24T12:00:00.000Z')
    if (assistant?.kind === 'message') expect(assistant.at).toBe('2026-07-24T12:00:05.000Z')
  })

  it('aligns follow-up user timestamps with the last assistant_message of the prior turn', () => {
    const items = messagesToUiItems([
      { role: 'user', content: 'first' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'ok' },
      { role: 'assistant', content: 'done' },
      { role: 'user', content: 'second' }
    ])
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:00.000Z',
        event: { type: 'status', runId: 'r1', status: 'running' }
      },
      {
        at: '2026-07-24T12:00:01.000Z',
        event: { type: 'assistant_message', runId: 'r1', content: '' }
      },
      {
        at: '2026-07-24T12:00:04.000Z',
        event: { type: 'assistant_message', runId: 'r1', content: 'done' }
      }
    ])
    const users = enriched.filter((i) => i.kind === 'message' && i.role === 'user')
    expect(users[1]?.kind).toBe('message')
    if (users[1]?.kind === 'message') {
      expect(users[1].at).toBe('2026-07-24T12:00:04.000Z')
    }
  })

  it('uses assistant_message events for multi-step assistant timestamps', () => {
    const items = messagesToUiItems([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'step 1' },
      { role: 'assistant', content: 'step 2' }
    ])
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:01.000Z',
        event: { type: 'assistant_message', runId: 'r1', content: 'step 1' }
      },
      {
        at: '2026-07-24T12:00:04.000Z',
        event: { type: 'assistant_message', runId: 'r1', content: 'step 2' }
      }
    ])
    const assistants = enriched.filter((i) => i.kind === 'message' && i.role === 'assistant')
    expect(assistants[0]?.kind).toBe('message')
    expect(assistants[1]?.kind).toBe('message')
    if (assistants[0]?.kind === 'message') expect(assistants[0].at).toBe('2026-07-24T12:00:01.000Z')
    if (assistants[1]?.kind === 'message') expect(assistants[1].at).toBe('2026-07-24T12:00:04.000Z')
  })

  it('prefers event timestamps over provisional live values', () => {
    const items: UiItem[] = [
      {
        kind: 'message',
        id: 'assistant-1',
        role: 'assistant',
        content: 'hi',
        at: '2026-07-24T11:00:00.000Z'
      }
    ]
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:05.000Z',
        event: { type: 'assistant_message', runId: 'r1', content: 'hi' }
      }
    ])
    const assistant = enriched[0]
    expect(assistant?.kind).toBe('message')
    if (assistant?.kind === 'message') {
      expect(assistant.at).toBe('2026-07-24T12:00:05.000Z')
    }
  })

  it('uses cancelled status for assistant timestamp fallback', () => {
    const items = messagesToUiItems([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'partial' }
    ])
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:00.000Z',
        event: { type: 'status', runId: 'r1', status: 'running' }
      },
      {
        at: '2026-07-24T12:00:03.000Z',
        event: { type: 'status', runId: 'r1', status: 'cancelled' }
      }
    ])
    const assistant = enriched.find((i) => i.kind === 'message' && i.role === 'assistant')
    expect(assistant?.kind).toBe('message')
    if (assistant?.kind === 'message') expect(assistant.at).toBe('2026-07-24T12:00:03.000Z')
  })

  it('ignores orphan tool events that do not match transcript rows', () => {
    const items = messagesToUiItems([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'ok' }
    ])
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:00.000Z',
        event: {
          type: 'tool_start',
          runId: 'r1',
          toolCallId: 'orphan',
          name: 'search',
          summary: 'query'
        }
      },
      {
        at: '2026-07-24T12:00:01.000Z',
        event: {
          type: 'tool_result',
          runId: 'r1',
          toolCallId: 'orphan',
          name: 'search',
          summary: 'query',
          ok: false,
          content: 'fail'
        }
      },
      {
        at: '2026-07-24T12:00:02.000Z',
        event: {
          type: 'tool_start',
          runId: 'r1',
          toolCallId: 'c1',
          name: 'read',
          summary: 'file'
        }
      }
    ])
    const tool = enriched.find((i) => i.kind === 'tool')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind === 'tool') {
      expect(tool.at).toBe('2026-07-24T12:00:02.000Z')
      expect(tool.tool.status).toBe('done')
    }
  })

  it('replays subagent_update events onto the parent tool row', () => {
    const items = messagesToUiItems([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'subagent', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'subagent', content: 'report', ok: true }
    ])
    const enriched = applyEventTimestamps(items, [
      {
        at: '2026-07-24T12:00:00.000Z',
        event: {
          type: 'subagent_update',
          runId: 'r1',
          parentToolCallId: 'c1',
          kind: 'thinking',
          text: 'Checking files'
        }
      },
      {
        at: '2026-07-24T12:00:01.000Z',
        event: {
          type: 'subagent_update',
          runId: 'r1',
          parentToolCallId: 'c1',
          kind: 'done',
          text: 'Finished'
        }
      }
    ])
    const tool = enriched.find((i) => i.kind === 'tool')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind === 'tool') {
      expect(tool.subagent).toEqual([
        { kind: 'thinking', text: 'Checking files' },
        { kind: 'done', text: 'Finished' }
      ])
    }
  })
})

describe('messagesToUiItems tool ok', () => {
  it('uses persisted ok flag instead of content heuristics', () => {
    const items = messagesToUiItems([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        toolName: 'read',
        content: 'permission denied',
        ok: false
      }
    ])
    const tool = items.find((i) => i.kind === 'tool')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind === 'tool') expect(tool.tool.status).toBe('fail')
  })
})
