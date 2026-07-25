import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { toolGlob } from '@main/agent/tools/glob'
import { toolGrep } from '@main/agent/tools/grep'
import { toolListDir } from '@main/agent/tools/listDir'
import { toolMultiEdit } from '@main/agent/tools/multiEdit'
import { toolDelete } from '@main/agent/tools/deletePath'
import { readTodos, toolTodoWrite } from '@main/agent/tools/todo'
import { htmlToMarkdown } from '@main/agent/tools/webFetch'
import { globToRegExp } from '@main/agent/tools/walk'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vyotiq-tools-'))
  mkdirSync(join(root, 'src', 'nested'), { recursive: true })
  mkdirSync(join(root, 'build'), { recursive: true })
  writeFileSync(join(root, '.gitignore'), 'ignored.ts\n', 'utf8')
  writeFileSync(join(root, 'README.md'), '# Readme\nalpha\n', 'utf8')
  writeFileSync(join(root, 'src', 'a.ts'), 'export const alpha = 1\nconst other = 2\n', 'utf8')
  writeFileSync(join(root, 'src', 'nested', 'b.ts'), 'export const beta = alpha\n', 'utf8')
  writeFileSync(join(root, 'src', 'ignored.ts'), 'export const ignored = true\n', 'utf8')
  writeFileSync(join(root, 'build', 'bundle.js'), 'alpha\n', 'utf8')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('globToRegExp', () => {
  it('matches ** across directories and zero directories', () => {
    const re = globToRegExp('src/**/*.ts')
    expect(re.test('src/a.ts')).toBe(true)
    expect(re.test('src/nested/b.ts')).toBe(true)
    expect(re.test('lib/a.ts')).toBe(false)
  })

  it('honours brace alternatives and single-segment stars', () => {
    const re = globToRegExp('*.{md,txt}')
    expect(re.test('README.md')).toBe(true)
    expect(re.test('notes.txt')).toBe(true)
    expect(re.test('src/README.md')).toBe(false)
  })
})

describe('toolGlob', () => {
  it('lists matching files and skips gitignored and build output', async () => {
    const out = await toolGlob(root, '**/*.ts')
    expect(out).toContain('src/a.ts')
    expect(out).toContain('src/nested/b.ts')
    expect(out).not.toContain('ignored.ts')
    expect(out).not.toContain('bundle.js')
  })

  it('reports no matches without throwing', async () => {
    expect(await toolGlob(root, '**/*.rs')).toContain('No files match')
  })
})

describe('toolGrep', () => {
  it('reports every matching line, not just the first file', async () => {
    const out = await toolGrep(root, 'alpha')
    expect(out).toContain('README.md:2')
    expect(out).toContain('src/a.ts:1')
    expect(out).toContain('src/nested/b.ts:1')
  })

  it('limits the search with an include glob', async () => {
    const out = await toolGrep(root, 'alpha', { include: 'src/**/*.ts' })
    expect(out).toContain('src/a.ts:1')
    expect(out).not.toContain('README.md')
  })

  it('adds context lines around a hit', async () => {
    const out = await toolGrep(root, 'other', { contextLines: 1 })
    expect(out).toContain('> 2|')
    expect(out).toContain('  1|')
  })

  it('rejects an invalid pattern instead of matching nothing', async () => {
    await expect(toolGrep(root, '([')).rejects.toThrow(/Invalid regex/)
  })
})

describe('toolListDir', () => {
  it('lists directories first and hides ignored entries', () => {
    const out = toolListDir(root, 'src')
    expect(out.indexOf('[dir]  nested/')).toBeLessThan(out.indexOf('[file] a.ts'))
    expect(out).not.toContain('ignored.ts')
  })

  it('refuses a file path', () => {
    expect(() => toolListDir(root, 'README.md')).toThrow(/Not a directory/)
  })
})

describe('toolMultiEdit', () => {
  it('writes every edit when all of them apply', () => {
    const out = toolMultiEdit(root, [
      { path: 'src/a.ts', contents: 'updated a\n' },
      { path: 'src/new.ts', contents: 'brand new\n' }
    ])

    expect(out).toContain('Applied 2 edits')
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('updated a\n')
    expect(readFileSync(join(root, 'src', 'new.ts'), 'utf8')).toBe('brand new\n')
  })

  it('writes nothing when one edit fails to apply', () => {
    expect(() =>
      toolMultiEdit(root, [
        { path: 'src/a.ts', contents: 'should not land\n' },
        { path: 'README.md', diff: '@@ -1,1 +1,1 @@\n-nonexistent line\n+replacement\n' }
      ])
    ).toThrow(/no files changed/)

    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toContain('export const alpha')
  })

  it('rejects a duplicated path rather than silently keeping the last write', () => {
    expect(() =>
      toolMultiEdit(root, [
        { path: 'src/a.ts', contents: 'first\n' },
        { path: 'src/a.ts', contents: 'second\n' }
      ])
    ).toThrow(/twice/)
  })
})

describe('toolDelete', () => {
  it('deletes a file', () => {
    expect(toolDelete(root, 'README.md')).toContain('Deleted README.md')
    expect(existsSync(join(root, 'README.md'))).toBe(false)
  })

  it('requires recursive for a non-empty directory', () => {
    expect(() => toolDelete(root, 'src')).toThrow(/recursive=true/)
    expect(existsSync(join(root, 'src'))).toBe(true)
    toolDelete(root, 'src', true)
    expect(existsSync(join(root, 'src'))).toBe(false)
  })

  it('refuses to escape the workspace or delete its root', () => {
    expect(() => toolDelete(root, '..')).toThrow()
    expect(() => toolDelete(root, '.')).toThrow(/workspace root/)
  })
})

describe('toolTodoWrite', () => {
  it('persists the list and renders progress', () => {
    const { content } = toolTodoWrite(root, [
      { id: '1', content: 'First', status: 'completed' },
      { id: '2', content: 'Second', status: 'in_progress' }
    ])

    expect(content).toContain('1/2 complete')
    expect(content).toContain('[x] First')
    expect(content).toContain('[~] Second')
    expect(readTodos(root)).toHaveLength(2)
  })

  it('merges status updates into the existing list', () => {
    toolTodoWrite(root, [
      { id: '1', content: 'First', status: 'pending' },
      { id: '2', content: 'Second', status: 'pending' }
    ])
    toolTodoWrite(root, [{ id: '2', content: 'Second', status: 'completed' }], true)

    const todos = readTodos(root)
    expect(todos).toHaveLength(2)
    expect(todos.find((todo) => todo.id === '2')?.status).toBe('completed')
  })

  it('rejects more than one in-progress task', () => {
    expect(() =>
      toolTodoWrite(root, [
        { id: '1', content: 'First', status: 'in_progress' },
        { id: '2', content: 'Second', status: 'in_progress' }
      ])
    ).toThrow(/one task/)
  })
})

describe('htmlToMarkdown', () => {
  it('keeps headings, links and list items while dropping scripts', () => {
    const md = htmlToMarkdown(
      '<html><head><style>body{}</style></head><body><h1>Title</h1><script>evil()</script>' +
        '<p>Hello &amp; welcome</p><ul><li>one</li><li>two</li></ul>' +
        '<a href="https://example.test">link</a></body></html>'
    )

    expect(md).toContain('# Title')
    expect(md).toContain('Hello & welcome')
    expect(md).toContain('- one')
    expect(md).toContain('[link](https://example.test)')
    expect(md).not.toContain('evil()')
    expect(md).not.toContain('body{}')
  })
})
