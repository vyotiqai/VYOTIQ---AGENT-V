/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  buildFileTree,
  type BrowserFileEntry
} from '@renderer/features/chat/components/ChangedFilesBrowser'

function entry(
  path: string,
  overrides: Partial<BrowserFileEntry> = {}
): BrowserFileEntry {
  return {
    path,
    statusLetter: 'M',
    statusLabel: 'Modified',
    added: 1,
    removed: 0,
    ...overrides
  }
}

describe('buildFileTree', () => {
  it('nests directories and sorts dirs before files', () => {
    const tree = buildFileTree([
      entry('z.ts'),
      entry('src/a.ts', { statusLetter: 'A', statusLabel: 'New', added: 2 }),
      entry('src/b/c.ts', { statusLetter: 'D', statusLabel: 'Deleted', removed: 3, added: 0 })
    ])
    expect(tree.map((n) => n.name)).toEqual(['src', 'z.ts'])
    const src = tree[0]
    expect(src?.kind).toBe('dir')
    if (src?.kind !== 'dir') throw new Error('expected dir')
    expect(src.added).toBe(2)
    expect(src.removed).toBe(3)
    expect(src.children.map((n) => n.name)).toEqual(['b', 'a.ts'])
  })
})
