import { describe, expect, it } from 'vitest'
import { parseGrepData } from '@renderer/features/chat/toolUi/parsers/grep'
import { parseListDirData } from '@renderer/features/chat/toolUi/parsers/listDir'
import { parseGlobData } from '@renderer/features/chat/toolUi/parsers/glob'
import { parseDeleteData } from '@renderer/features/chat/toolUi/parsers/delete'
import { parseTodoData } from '@renderer/features/chat/toolUi/parsers/todo'
import type { UiToolRow } from '@shared/transcript'

function tool(overrides: Partial<UiToolRow> & Pick<UiToolRow, 'name'>): UiToolRow {
  return { id: 't1', summary: '', status: 'done', ...overrides }
}

describe('grep parser', () => {
  it('groups context matches by file', () => {
    const data = parseGrepData(
      tool({
        name: 'grep',
        argsPreview: JSON.stringify({ pattern: 'foo' }),
        content: 'src/a.ts:10\n> 10| const foo = 1\n  9| before\n  11| after'
      })
    )
    expect(data.matchCount).toBeGreaterThan(0)
    expect(data.groups[0]?.file).toBe('src/a.ts')
  })
})

describe('list_dir parser', () => {
  it('parses directory entries', () => {
    const data = parseListDirData(
      tool({
        name: 'list_dir',
        content: 'src (2 entries)\n[dir]  components/\n[file] index.ts (1K)'
      })
    )
    expect(data.totalEntries).toBe(2)
    expect(data.entries).toHaveLength(2)
    expect(data.entries[0]?.kind).toBe('dir')
    expect(data.entries[1]?.size).toBe('1K')
  })

  it('normalizes bare byte counts in file sizes', () => {
    const data = parseListDirData(
      tool({
        name: 'list_dir',
        content: '. (1 entries)\n[file] notes.md (1338)'
      })
    )
    expect(data.entries[0]?.size).toBe('1K')
  })
})

describe('glob parser', () => {
  it('collects paths', () => {
    const data = parseGlobData(
      tool({
        name: 'glob',
        argsPreview: JSON.stringify({ pattern: '**/*.ts' }),
        content: 'src/a.ts\nsrc/b.ts'
      })
    )
    expect(data.paths).toEqual(['src/a.ts', 'src/b.ts'])
  })
})

describe('delete parser', () => {
  it('always has a message for the body', () => {
    const data = parseDeleteData(
      tool({
        name: 'delete',
        argsPreview: JSON.stringify({ path: 'old.txt', recursive: true }),
        content: 'Deleted old.txt'
      })
    )
    expect(data.path).toBe('old.txt')
    expect(data.recursive).toBe(true)
    expect(data.message).toContain('Deleted')
  })
})

describe('todo parser', () => {
  it('parses checklist items', () => {
    const data = parseTodoData(
      tool({
        name: 'todo_write',
        content: '1/2 complete\n[ ] First\n[x] Second'
      })
    )
    expect(data.total).toBe(2)
    expect(data.items).toHaveLength(2)
    expect(data.items[1]?.status).toBe('completed')
  })
})
