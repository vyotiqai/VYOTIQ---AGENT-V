import { describe, expect, it } from 'vitest'
import {
  buildTranscriptRows,
  rowLeadingGap,
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
    expect(rows.map((row) => row.kind)).toEqual(['activity', 'card', 'activity', 'card'])
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
      'turn',
      'card',
      'user',
      'turn',
      'activity'
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
      'turn',
      'activity',
      'user',
      'turn',
      'activity'
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

  it('coalesces activity batches split by thinking within a turn', () => {
    const items: UiItem[] = [
      tool('r1', 'read'),
      tool('r2', 'read'),
      {
        kind: 'message',
        id: 'm1',
        role: 'assistant',
        thinking: 'mapping the tree',
        content: ''
      },
      tool('r3', 'read'),
      tool('r4', 'read')
    ]
    const rows = buildTranscriptRows(items)
    const activities = rows.filter((row) => row.kind === 'activity')
    expect(activities).toHaveLength(1)
    if (activities[0]?.kind === 'activity') {
      expect(activities[0].tools).toHaveLength(4)
    }
    expect(rows.filter((row) => row.kind === 'thinking')).toHaveLength(1)
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

  it('attaches thinking activity while reasoning streams', () => {
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

  it('shows a starting turn summary while pendingRun is true', () => {
    const items: UiItem[] = [{ kind: 'message', id: 'u1', role: 'user', content: 'go' }]
    const rows = buildTranscriptRows(items, { pendingRun: true })
    const summary = rows.find((row) => row.kind === 'turn')
    expect(summary?.kind).toBe('turn')
    if (summary?.kind === 'turn') {
      expect(summary.span.active).toBe(true)
      expect(summary.span.activity).toEqual({ kind: 'starting' })
    }
  })
})
