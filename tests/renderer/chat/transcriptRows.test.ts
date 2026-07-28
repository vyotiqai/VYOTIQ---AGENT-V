import { describe, expect, it } from 'vitest'
import {
  buildTranscriptRows,
  isTurnWorkRow,
  rowLeadingGap,
  stabilizeTranscriptRows,
  transcriptRowFingerprint,
  TURN_GAP_PX
} from '@renderer/features/chat/utils/transcriptRows'
import type { UiItem } from '@shared/transcript'

function tool(id: string, name = 'read', expanded = false): UiItem {
  return {
    kind: 'tool',
    id,
    toolExpanded: expanded,
    tool: { id, name, summary: id, status: 'done' }
  }
}

describe('buildTranscriptRows', () => {
  it('assigns turn indices starting from user messages', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'hi' },
      { kind: 'message', id: 'a1', role: 'assistant', content: 'hello' },
      { kind: 'message', id: 'u2', role: 'user', content: 'again' },
      { kind: 'message', id: 'a2', role: 'assistant', content: 'sure' }
    ]
    const rows = buildTranscriptRows(items)
    expect(rows[0]?.kind).toBe('user')
    expect(rows[0]?.turnIndex).toBe(0)
    expect(rows[2]?.kind).toBe('user')
    expect(rows[2]?.turnIndex).toBe(1)
  })

  it('groups consecutive tools into a single activity row', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'm1', role: 'assistant', content: 'go' },
      tool('t1'),
      tool('t2'),
      tool('t3'),
      { kind: 'message', id: 'm2', role: 'assistant', content: 'done' }
    ]
    const rows = buildTranscriptRows(items)
    const activityRows = rows.filter((row) => row.kind === 'activity')
    expect(activityRows).toHaveLength(1)
    if (activityRows[0]?.kind === 'activity') {
      expect(activityRows[0].tools).toHaveLength(3)
    }
  })

  it('breaks commands and edits out of a mixed batch into their own cards', () => {
    const rows = buildTranscriptRows([
      tool('r1', 'read'),
      tool('t1', 'terminal'),
      tool('r2', 'read'),
      tool('e1', 'edit')
    ])
    expect(rows.map((row) => row.kind)).toEqual(['activity', 'card', 'card'])
    const activity = rows.find((row) => row.kind === 'activity')
    if (activity?.kind === 'activity') {
      expect(activity.tools.map((item) => item.id)).toEqual(['r1', 'r2'])
    }
  })

  it('gives a lone terminal or edit call its own card', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'build it' },
      tool('t1', 'terminal'),
      { kind: 'message', id: 'u2', role: 'user', content: 'and read it' },
      tool('r1', 'read')
    ]
    expect(buildTranscriptRows(items).map((row) => row.kind)).toEqual([
      'user',
      'card',
      'turn',
      'user',
      'activity',
      'turn'
    ])
  })

  it('keeps mid-loop narration inline, in the order it happened', () => {
    const items: UiItem[] = [
      tool('a1'),
      { kind: 'message', id: 'm', role: 'assistant', content: 'now the router' },
      tool('b1')
    ]
    expect(buildTranscriptRows(items).map((row) => row.kind)).toEqual([
      'activity',
      'text',
      'activity'
    ])
  })

  it('does not split a tool stretch on assistant rows that render nothing', () => {
    // Splitting there produced a stack of identical group headers with no
    // visible separator between them.
    const items: UiItem[] = [
      tool('a1'),
      tool('a2'),
      { kind: 'message', id: 'm', role: 'assistant', content: '' },
      tool('b1')
    ]
    const rows = buildTranscriptRows(items)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('activity')
    if (rows[0]?.kind === 'activity') {
      expect(rows[0].tools.map((item) => item.id)).toEqual(['a1', 'a2', 'b1'])
    }
  })

  it('gives a command its own card even mid-batch', () => {
    const items: UiItem[] = [
      tool('a1'),
      { kind: 'message', id: 'm', role: 'assistant', content: 'building' },
      tool('t1', 'terminal')
    ]
    expect(buildTranscriptRows(items).map((row) => row.kind)).toEqual([
      'activity',
      'text',
      'card'
    ])
  })

  it('splits a tool stretch across turns', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'first' },
      tool('a1'),
      { kind: 'message', id: 'u2', role: 'user', content: 'second' },
      tool('b1')
    ]
    const rows = buildTranscriptRows(items)
    expect(rows.map((row) => row.kind)).toEqual([
      'user',
      'activity',
      'turn',
      'user',
      'activity',
      'turn'
    ])
  })

  it('times a turn from the prompt to the last thing it produced', () => {
    const readTool = tool('t1')
    readTool.at = '2026-07-25T10:00:05.000Z'
    readTool.groupTiming = { startedAt: 5_000, endedAt: 12_000 }
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'go', at: '2026-07-25T10:00:00.000Z' },
      readTool,
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        content: 'done',
        at: '2026-07-25T10:00:20.000Z'
      }
    ]
    const summary = buildTranscriptRows(items).find((row) => row.kind === 'turn')
    expect(summary?.kind).toBe('turn')
    if (summary?.kind === 'turn') {
      expect(summary.span.endedAt! - summary.span.startedAt!).toBe(20_000)
      expect(summary.span.active).toBe(false)
    }
  })

  it('marks a turn active while a tool is still running', () => {
    const running = tool('t1')
    running.tool.status = 'running'
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'go' },
      running
    ]
    const summary = buildTranscriptRows(items).find((row) => row.kind === 'turn')
    if (summary?.kind === 'turn') expect(summary.span.active).toBe(true)
  })

  it('omits the turn summary when a turn did no work', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'hi' },
      { kind: 'message', id: 'a1', role: 'assistant', content: 'hello' }
    ]
    expect(buildTranscriptRows(items).some((row) => row.kind === 'turn')).toBe(false)
  })

  it('only the closing answer of a turn is marked final', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'go' },
      { kind: 'message', id: 'a1', role: 'assistant', content: 'first' },
      { kind: 'message', id: 'a2', role: 'assistant', content: 'second' }
    ]
    const finals = buildTranscriptRows(items)
      .filter((row) => row.kind === 'text')
      .map((row) => (row.kind === 'text' ? row.final : null))
    expect(finals).toEqual([false, true])
  })

  it('does not treat mid-turn narration as final when work continues after it', () => {
    const todo = tool('todo1', 'todo_write')
    todo.tool.summary = '0/5 complete'
    const running = tool('sub1', 'subagent')
    running.tool.status = 'running'
    running.tool.summary = 'Audit the codebase'
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'hi' },
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        thinking: 'Planning the full repository audit now.',
        content: ''
      },
      { kind: 'message', id: 'a2', role: 'assistant', content: 'Hi again! Starting the audit.' },
      todo,
      {
        kind: 'message',
        id: 'a3',
        role: 'assistant',
        thinking: 'Launching sub-agents.',
        thinkingStreaming: true,
        content: ''
      },
      running
    ]
    const rows = buildTranscriptRows(items)
    const kinds = rows.map((row) => row.kind)
    const narration = rows.find((row) => row.kind === 'text' && row.id === 'a2')
    const summaryIndex = rows.findIndex((row) => row.kind === 'turn')
    const subagentIndex = rows.findIndex((row) => row.kind === 'activity')

    expect(narration?.kind === 'text' ? narration.final : undefined).toBe(false)
    expect(summaryIndex).toBeGreaterThan(subagentIndex)
    expect(kinds.indexOf('turn')).toBeGreaterThan(kinds.lastIndexOf('activity'))
  })

  it('places the turn summary after work and before a trailing closing answer', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'go' },
      tool('r1', 'read'),
      { kind: 'message', id: 'a1', role: 'assistant', content: 'Here is the answer.' }
    ]
    const kinds = buildTranscriptRows(items).map((row) => row.kind)
    expect(kinds).toEqual(['user', 'activity', 'turn', 'text'])
  })

  it('rolls up a turn that edited several files', () => {
    const first = tool('e1', 'edit')
    first.tool.argsPreview = JSON.stringify({ path: 'src/a.ts', contents: 'x\ny\n' })
    const second = tool('e2', 'edit')
    second.tool.argsPreview = JSON.stringify({ path: 'src/b.ts', contents: 'z\n' })

    const changes = buildTranscriptRows([
      { kind: 'message', id: 'u1', role: 'user', content: 'edit both' },
      first,
      second
    ]).find((row) => row.kind === 'changes')

    expect(changes?.kind).toBe('changes')
    if (changes?.kind === 'changes') {
      expect(changes.files).toEqual([
        { path: 'src/a.ts', added: 2, removed: 0 },
        { path: 'src/b.ts', added: 1, removed: 0 }
      ])
    }
  })

  it('does not repeat a single edit that already has its own card', () => {
    const only = tool('e1', 'edit')
    only.tool.argsPreview = JSON.stringify({ path: 'src/a.ts', contents: 'x\n' })
    const rows = buildTranscriptRows([
      { kind: 'message', id: 'u1', role: 'user', content: 'edit it' },
      only
    ])
    expect(rows.some((row) => row.kind === 'changes')).toBe(false)
  })

  it('adds up repeated edits to the same file', () => {
    const first = tool('e1', 'edit')
    first.tool.argsPreview = JSON.stringify({ path: 'src/a.ts', contents: 'x\ny\n' })
    const second = tool('e2', 'edit')
    second.tool.argsPreview = JSON.stringify({ path: 'src/a.ts', diff: '@@ -1 +1 @@\n-old\n+new' })
    const other = tool('e3', 'edit')
    other.tool.argsPreview = JSON.stringify({ path: 'src/b.ts', contents: 'z\n' })

    const changes = buildTranscriptRows([
      { kind: 'message', id: 'u1', role: 'user', content: 'go' },
      first,
      second,
      other
    ]).find((row) => row.kind === 'changes')

    if (changes?.kind === 'changes') {
      expect(changes.files[0]).toEqual({ path: 'src/a.ts', added: 3, removed: 1 })
    }
  })

  it('reserves extra lead-in for user prompts that open a later turn', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'first' },
      { kind: 'message', id: 'u2', role: 'user', content: 'second' }
    ]
    const [first, second] = buildTranscriptRows(items)
    expect(rowLeadingGap(first!)).toBe(0)
    expect(rowLeadingGap(second!)).toBe(TURN_GAP_PX)
  })

  it('emits an approval row instead of a card while an edit is gated', () => {
    const rows = buildTranscriptRows([
      {
        kind: 'tool',
        id: 'w1',
        tool: { id: 'w1', name: 'edit', summary: 'a.ts', status: 'running' },
        approval: {
          requestId: 'req-1',
          toolName: 'edit',
          summary: 'a.ts',
          argsPreview: '{}',
          mutating: true
        }
      }
    ])
    expect(rows.map((row) => row.kind)).toEqual(['approval'])
    expect(rows.some((row) => row.kind === 'card')).toBe(false)
  })

  it('strips leaked tool JSON from assistant text rows', () => {
    const rows = buildTranscriptRows([
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        content: 'tool {"edits":[{"path":"api.ts","contents":"x"}]}\nVerified the routes.'
      }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('text')
    if (rows[0]?.kind === 'text') {
      expect(rows[0].item.content).toBe('Verified the routes.')
    }
  })

  it('hides in-progress tool JSON while assistant text is still streaming', () => {
    const rows = buildTranscriptRows([
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        content: 'Checking routes.\ntool {"path":"api.ts"',
        streaming: true
      }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('text')
    if (rows[0]?.kind === 'text') {
      expect(rows[0].item.content).toBe('Checking routes.')
    }
  })

  it('keeps terminal tools in card presentation once locked', () => {
    const rows = buildTranscriptRows([
      {
        kind: 'tool',
        id: 't1',
        tool: {
          id: 't1',
          name: 'terminal',
          summary: 'pnpm test',
          status: 'running',
          argsPreview: '{"command":"pnpm test"}',
          presentation: 'prominent'
        }
      }
    ])
    expect(rows[0]?.kind).toBe('card')
  })

  it('keeps activity batches split by thinking in step order', () => {
    const items: UiItem[] = [
      tool('r1', 'read'),
      tool('r2', 'read'),
      {
        kind: 'message',
        id: 'm1',
        role: 'assistant',
        thinking: 'Mapping the repository tree before edits.',
        content: ''
      },
      tool('r3', 'read'),
      tool('r4', 'read')
    ]
    const rows = buildTranscriptRows(items)
    expect(rows.map((row) => row.kind)).toEqual(['activity', 'thinking', 'activity'])
    const activities = rows.filter((row) => row.kind === 'activity')
    expect(activities).toHaveLength(2)
    if (activities[0]?.kind === 'activity' && activities[1]?.kind === 'activity') {
      expect(activities[0].tools).toHaveLength(2)
      expect(activities[1].tools).toHaveLength(2)
    }
  })

  it('merges duplicate activity groups across shallow thinking separators', () => {
    const items: UiItem[] = [
      tool('r1', 'read'),
      tool('g1', 'grep'),
      {
        kind: 'message',
        id: 'm1',
        role: 'assistant',
        thinking: 'ok',
        content: ''
      },
      tool('r2', 'read'),
      tool('g2', 'grep')
    ]
    const rows = buildTranscriptRows(items)
    const activities = rows.filter((row) => row.kind === 'activity')
    expect(activities).toHaveLength(1)
    if (activities[0]?.kind === 'activity') {
      expect(activities[0].tools).toHaveLength(4)
    }
  })

  it('merges duplicate activity groups across prominent tool cards', () => {
    const items: UiItem[] = [
      tool('r1', 'read'),
      tool('d1', 'list_dir'),
      tool('t1', 'terminal'),
      tool('r2', 'read'),
      tool('d2', 'list_dir')
    ]
    const rows = buildTranscriptRows(items)
    expect(rows.map((row) => row.kind)).toEqual(['activity', 'card'])
    const activity = rows[0]
    if (activity?.kind === 'activity') {
      expect(activity.tools.map((item) => item.id)).toEqual(['r1', 'd1', 'r2', 'd2'])
    }
  })

  it('keeps step reasoning inline between tool batches', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'audit' },
      {
        kind: 'message',
        id: 'm1',
        role: 'assistant',
        thinking: 'First I will read the core files.',
        content: ''
      },
      tool('r1', 'read'),
      {
        kind: 'message',
        id: 'm2',
        role: 'assistant',
        thinking: 'Next I will grep for auth usage.',
        content: ''
      },
      tool('g1', 'grep'),
      {
        kind: 'message',
        id: 'm3',
        role: 'assistant',
        thinking: 'Finally I will run the tests.',
        content: ''
      },
      tool('t1', 'terminal')
    ]
    const rows = buildTranscriptRows(items)
    expect(rows.map((row) => row.kind)).toEqual([
      'user',
      'thinking',
      'activity',
      'thinking',
      'activity',
      'thinking',
      'card',
      'turn'
    ])
  })

  it('attaches tool activity to an active turn with a running tool', () => {
    const running = tool('t1', 'read')
    running.tool.status = 'running'
    running.tool.summary = 'package.json'
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'go' },
      running
    ]
    const summary = buildTranscriptRows(items).find((row) => row.kind === 'turn')
    expect(summary?.kind).toBe('turn')
    if (summary?.kind === 'turn') {
      expect(summary.span.activity).toEqual({
        kind: 'tool',
        label: 'Reading',
        detail: 'package.json'
      })
    }
  })

  it('attaches thinking activity while reasoning streams and no tools are running', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'go' },
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        content: '',
        thinking: 'Let me reason about this carefully.',
        thinkingStreaming: true
      }
    ]
    const summary = buildTranscriptRows(items).find((row) => row.kind === 'turn')
    if (summary?.kind === 'turn') {
      expect(summary.span.activity).toEqual({ kind: 'thinking' })
    }
  })

  it('shows a planning turn summary while pendingRun is true', () => {
    const items: UiItem[] = [{ kind: 'message', id: 'u1', role: 'user', content: 'go' }]
    const rows = buildTranscriptRows(items, { pendingRun: true })
    const summary = rows.find((row) => row.kind === 'turn')
    expect(summary?.kind).toBe('turn')
    if (summary?.kind === 'turn') {
      expect(summary.span.active).toBe(true)
      expect(summary.span.activity).toEqual({ kind: 'planning' })
    }
  })

  it('prefers a running subagent over streaming thinking in the turn summary', () => {
    const running = tool('sub1', 'subagent')
    running.tool.status = 'running'
    running.tool.summary = 'Audit routes'
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'go' },
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        thinking: 'Let me delegate.',
        thinkingStreaming: true,
        content: ''
      },
      running
    ]
    const summary = buildTranscriptRows(items).find((row) => row.kind === 'turn')
    if (summary?.kind === 'turn') {
      expect(summary.span.activity).toEqual({
        kind: 'tool',
        label: 'Investigating',
        detail: 'Audit routes'
      })
    }
  })

  it('keeps the turn summary live while running before the first stream event', () => {
    const items: UiItem[] = [{ kind: 'message', id: 'u1', role: 'user', content: 'go' }]
    const rows = buildTranscriptRows(items, { running: true })
    const summary = rows.find((row) => row.kind === 'turn')
    expect(summary?.kind).toBe('turn')
    if (summary?.kind === 'turn') {
      expect(summary.span.active).toBe(true)
      expect(summary.span.activity).toEqual({ kind: 'planning' })
    }
  })

  it('keeps only the latest todo_write card even when separated by thinking', () => {
    const first = tool('todo1', 'todo_write')
    first.tool.summary = '5 tasks'
    const second = tool('todo2', 'todo_write')
    second.tool.summary = '0/5 complete'
    second.tool.content = '0/5 complete\n[ ] Audit core library code'
    const rows = buildTranscriptRows([
      { kind: 'message', id: 'u1', role: 'user', content: 'plan' },
      first,
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        thinking: 'Updating the checklist with the latest progress.',
        content: ''
      },
      second
    ])
    const todoCards = rows.filter((row) => row.kind === 'card' && row.item.tool.name === 'todo_write')
    expect(todoCards).toHaveLength(1)
    if (todoCards[0]?.kind === 'card') {
      expect(todoCards[0].item.id).toBe('todo2')
    }
  })

  it('groups parallel subagent tools into one activity row', () => {
    const first = tool('sub1', 'subagent')
    first.tool.summary = 'Audit core library'
    const second = tool('sub2', 'subagent')
    second.tool.summary = 'Audit API routes'
    const rows = buildTranscriptRows([
      { kind: 'message', id: 'u1', role: 'user', content: 'audit' },
      first,
      second
    ])
    expect(rows.map((row) => row.kind)).toEqual(['user', 'activity', 'turn'])
    const activity = rows.find((row) => row.kind === 'activity')
    if (activity?.kind === 'activity') {
      expect(activity.tools).toHaveLength(2)
      expect(activity.tools.map((item) => item.id)).toEqual(['sub1', 'sub2'])
    }
  })

  it('omits short finished thinking so padded empty gaps are not created', () => {
    const rows = buildTranscriptRows([
      { kind: 'message', id: 'u1', role: 'user', content: 'hi' },
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        thinking: 'OK',
        content: 'Done.'
      }
    ])
    expect(rows.map((row) => row.kind)).toEqual(['user', 'text'])
  })

  it('shows Thinking on the timeline when showThinking is false but reasoning is streaming', () => {
    const items: UiItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: 'go' },
      {
        kind: 'message',
        id: 'a1',
        role: 'assistant',
        thinking: 'Let me reason about this carefully.',
        thinkingStreaming: true,
        content: ''
      }
    ]
    const rows = buildTranscriptRows(items, { showThinking: false, running: true })
    expect(rows.some((row) => row.kind === 'thinking')).toBe(false)
    const summary = rows.find((row) => row.kind === 'turn')
    if (summary?.kind === 'turn') {
      expect(summary.span.activity?.kind).toBe('thinking')
    }
  })

  it('keeps approval rows visible when a turn is collapsed', () => {
    expect(
      isTurnWorkRow({
        kind: 'approval',
        id: 'a1',
        turnIndex: 0,
        item: {
          kind: 'tool',
          id: 't1',
          tool: { id: 't1', name: 'edit', summary: 'edit', status: 'running' },
          approval: {
            requestId: 'r1',
            toolName: 'edit',
            summary: 'edit',
            mutating: true
          }
        }
      })
    ).toBe(false)
  })

  it('hides running tool cards when a turn is collapsed (timeline owns live phase)', () => {
    expect(
      isTurnWorkRow({
        kind: 'card',
        id: 'c-run',
        turnIndex: 0,
        item: {
          kind: 'tool',
          id: 't-run',
          tool: { id: 't-run', name: 'terminal', summary: 'npm test', status: 'running' }
        }
      })
    ).toBe(true)
    expect(
      isTurnWorkRow({
        kind: 'card',
        id: 'c-done',
        turnIndex: 0,
        item: {
          kind: 'tool',
          id: 't-done',
          tool: { id: 't-done', name: 'terminal', summary: 'npm test', status: 'done' }
        }
      })
    ).toBe(true)
  })
})

describe('transcriptRowFingerprint / stabilizeTranscriptRows', () => {
  it('invalidates activity identity when tool content grows', () => {
    const base: UiItem = {
      kind: 'tool',
      id: 't1',
      tool: {
        id: 't1',
        name: 'read',
        summary: 'a.ts',
        status: 'done',
        content: 'short'
      }
    }
    const grown: UiItem = {
      ...base,
      tool: { ...base.tool, content: 'short'.repeat(40) }
    }
    const prev = buildTranscriptRows([base])
    const next = buildTranscriptRows([grown])
    expect(prev[0]?.kind).toBe('activity')
    expect(next[0]?.kind).toBe('activity')
    if (prev[0]?.kind !== 'activity' || next[0]?.kind !== 'activity') return
    expect(transcriptRowFingerprint(prev[0])).not.toBe(transcriptRowFingerprint(next[0]))
    const stable = stabilizeTranscriptRows(prev, next)
    expect(stable[0]).toBe(next[0])
    expect(stable[0]).not.toBe(prev[0])
  })

  it('invalidates card identity when subagent progress updates', () => {
    const base: UiItem = {
      kind: 'tool',
      id: 'edit-1',
      tool: {
        id: 'edit-1',
        name: 'edit',
        summary: 'a.ts',
        status: 'running',
        presentation: 'prominent'
      },
      subagent: [{ kind: 'text', text: 'hi' }]
    }
    const grown: UiItem = {
      ...base,
      subagent: [
        { kind: 'text', text: 'hi' },
        { kind: 'tool', text: 'read pkg' }
      ]
    }
    const prev = buildTranscriptRows([base])
    const next = buildTranscriptRows([grown])
    expect(prev[0]?.kind).toBe('card')
    expect(next[0]?.kind).toBe('card')
    if (prev[0]?.kind !== 'card' || next[0]?.kind !== 'card') return
    expect(transcriptRowFingerprint(prev[0])).not.toBe(transcriptRowFingerprint(next[0]))
    const stable = stabilizeTranscriptRows(prev, next)
    expect(stable[0]).not.toBe(prev[0])
  })

  it('reuses activity row identity when only unrelated fields are unchanged', () => {
    const item: UiItem = {
      kind: 'tool',
      id: 't1',
      tool: { id: 't1', name: 'read', summary: 'a.ts', status: 'done', content: 'body' }
    }
    const prev = buildTranscriptRows([item])
    const next = buildTranscriptRows([{ ...item }])
    const stable = stabilizeTranscriptRows(prev, next)
    expect(stable[0]).toBe(prev[0])
  })
})
