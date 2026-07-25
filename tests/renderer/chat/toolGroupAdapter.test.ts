import { describe, expect, it } from 'vitest'
import { mapToolGroupProps } from '@renderer/features/chat/utils/toolGroupAdapter'
import type { UiToolRow } from '@shared/transcript'

function tool(
  id: string,
  name: string,
  summary: string,
  status: UiToolRow['status'] = 'done',
  content?: string
): UiToolRow {
  return { id, name, summary, status, content }
}

describe('mapToolGroupProps', () => {
  it('maps pending state when group is open and tools are running', () => {
    const result = mapToolGroupProps(
      [tool('t1', 'read', 'src/a.ts', 'running'), tool('t2', 'search', 'query', 'running')],
      { groupTiming: { startedAt: 1_000 } }
    )
    expect(result.state).toBe('pending')
    expect(result.nestedTools).toHaveLength(2)
    expect(result.nestedTools[0]?.category).toBe('file')
    expect(result.nestedTools[1]?.category).toBe('search')
    expect(result.summary).toBe('1 file and 1 search')
  })

  it('maps completed state when group timing is closed', () => {
    const result = mapToolGroupProps(
      [
        tool('t1', 'read', 'src/a.ts'),
        tool('t2', 'terminal', 'pnpm test'),
        tool('t3', 'search', 'foo')
      ],
      { groupTiming: { startedAt: 1_000, endedAt: 7_000 } }
    )
    expect(result.state).toBe('completed')
    expect(result.summary).toBe('1 file, 1 search, and 1 command')
    expect(result.elapsedDisplay).toBe('6s')
  })

  it('completes a finished group whose timing is still open', () => {
    const result = mapToolGroupProps([tool('t1', 'read', 'src/a.ts'), tool('t2', 'search', 'q')], {
      groupTiming: { startedAt: 1_000 }
    })
    expect(result.state).toBe('completed')
  })

  it('maps interrupted state from cancelled tool content', () => {
    const result = mapToolGroupProps(
      [tool('t1', 'read', 'src/a.ts', 'fail', 'Cancelled')],
      { groupTiming: { startedAt: 1_000, endedAt: 2_000 } }
    )
    expect(result.state).toBe('interrupted')
  })

  it('maps MCP tools to search category with tool name title', () => {
    const result = mapToolGroupProps(
      [tool('t1', 'mcp__github__list_issues', 'vyotiq', 'done')],
      { groupTiming: { startedAt: 1_000, endedAt: 2_000 } }
    )
    expect(result.nestedTools[0]?.category).toBe('search')
    expect(result.nestedTools[0]?.title).toBe('list_issues')
    expect(result.nestedTools[0]?.subtitle).toBe('vyotiq')
  })

  it('uses basename for file tool subtitles', () => {
    const result = mapToolGroupProps([tool('t1', 'read', 'src/components/Chat.tsx')], {
      groupTiming: { startedAt: 1_000, endedAt: 2_000 }
    })
    expect(result.nestedTools[0]?.subtitle).toBe('Chat.tsx')
  })
})
