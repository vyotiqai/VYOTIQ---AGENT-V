import { describe, expect, it } from 'vitest'
import type { UiItem } from '@shared/transcript'
import { buildTranscriptRows } from '@renderer/features/chat/utils/transcriptRows'
import { collectTurnFileDiffs } from '@renderer/features/chat/utils/turnFileDiffs'
import { isPlanDraftReady, PLAN_STUB } from '@renderer/features/chat/components/composer/PlanHandoff'

function tool(
  id: string,
  name: string,
  args: Record<string, unknown>,
  status: 'done' | 'running' = 'done'
): Extract<UiItem, { kind: 'tool' }> {
  return {
    kind: 'tool',
    id,
    at: Date.now(),
    tool: {
      toolCallId: id,
      name,
      status,
      summary: typeof args.path === 'string' ? args.path : name,
      argsPreview: JSON.stringify(args)
    }
  }
}

describe('collectTurnFileDiffs', () => {
  it('buckets str_replace diffs by path for the turn', () => {
    const rows = buildTranscriptRows([
      { kind: 'message', id: 'u1', role: 'user', content: 'fix', at: 1 },
      tool('t1', 'str_replace', {
        path: 'src/a.ts',
        old_string: 'foo',
        new_string: 'bar'
      })
    ])
    const diffs = collectTurnFileDiffs(rows)
    const turn0 = diffs.get(0)
    expect(turn0?.get('src/a.ts')?.some((l) => l.kind === 'del')).toBe(true)
    expect(turn0?.get('src/a.ts')?.some((l) => l.kind === 'add')).toBe(true)
  })

  it('skips in-flight writing tools', () => {
    const rows = buildTranscriptRows([
      { kind: 'message', id: 'u1', role: 'user', content: 'fix', at: 1 },
      tool(
        't1',
        'edit',
        { path: 'src/a.ts', contents: 'x\n' },
        'running'
      )
    ])
    const diffs = collectTurnFileDiffs(rows)
    expect(diffs.get(0)?.size ?? 0).toBe(0)
  })
})

describe('isPlanDraftReady', () => {
  it('rejects empty and stub plan.md', () => {
    expect(isPlanDraftReady(null)).toBe(false)
    expect(isPlanDraftReady(PLAN_STUB)).toBe(false)
  })

  it('accepts a drafted plan', () => {
    expect(isPlanDraftReady('# Plan\n\n1. Do the thing\n')).toBe(true)
  })
})
