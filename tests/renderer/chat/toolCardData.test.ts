import { describe, expect, it } from 'vitest'
import {
  fileBadge,
  parseDiffPreview,
  parseEditCardData,
  parseTerminalCardData
} from '@renderer/features/chat/toolUi'
import type { UiToolRow } from '@shared/transcript'

function tool(overrides: Partial<UiToolRow> & Pick<UiToolRow, 'name'>): UiToolRow {
  return {
    id: 't1',
    summary: '',
    status: 'done',
    ...overrides
  }
}

describe('parseTerminalCardData', () => {
  it('extracts command, output, stderr, and exit code', () => {
    const data = parseTerminalCardData(
      tool({
        name: 'terminal',
        argsPreview: JSON.stringify({ command: 'npm run build' }),
        content: 'cwd: /ws\n\nbuild output\nstderr:\nerror line\nexit_code: 1'
      })
    )
    expect(data.command).toBe('npm run build')
    expect(data.exitCode).toBe(1)
    expect(data.stderr).toContain('error line')
    expect(data.output).toContain('build output')
  })
})

describe('parseEditCardData', () => {
  it('reports added line count for whole-file writes', () => {
    const data = parseEditCardData(
      tool({
        name: 'edit',
        argsPreview: JSON.stringify({ path: 'src/foo.ts', contents: 'a\nb\nc\n' })
      })
    )
    expect(data.path).toBe('src/foo.ts')
    expect(data.changeLabel).toBe('+3')
  })

  it('counts diff lines from unified diff args', () => {
    const diff = '--- a\n+++ b\n@@\n-old\n+new\n+line'
    const data = parseEditCardData(
      tool({
        name: 'edit',
        argsPreview: JSON.stringify({ path: 'x.ts', diff })
      })
    )
    expect(data.changeLabel).toBe('+2 -1')
    expect(data.added).toBe(2)
    expect(data.removed).toBe(1)
  })
  it('counts multi_edit edits[] for the header totals', () => {
    const data = parseEditCardData(
      tool({
        name: 'multi_edit',
        summary: 'a.ts, b.ts',
        argsPreview: JSON.stringify({
          edits: [
            { path: 'a.ts', contents: 'one\ntwo\n' },
            { path: 'b.ts', diff: '@@\n-old\n+new\n' }
          ]
        })
      })
    )
    expect(data.path).toBe('a.ts, b.ts')
    expect(data.added).toBe(3)
    expect(data.removed).toBe(1)
    expect(data.changeLabel).toBe('+3 -1')
  })
})

describe('parseDiffPreview', () => {
  it('numbers lines against the file as it stands after the edit', () => {
    const diff = ['--- a/x.ts', '+++ b/x.ts', '@@ -10,3 +10,4 @@', ' keep', '-gone', '+added', ' tail'].join(
      '\n'
    )
    const lines = parseDiffPreview(
      tool({ name: 'edit', argsPreview: JSON.stringify({ path: 'x.ts', diff }) })
    )

    expect(lines.map((line) => [line.kind, line.text, line.lineNumber])).toEqual([
      ['context', 'keep', 10],
      ['del', 'gone', null],
      ['add', 'added', 11],
      ['context', 'tail', 12]
    ])
  })

  it('separates hunks so distant edits do not read as adjacent', () => {
    const diff = ['@@ -1,1 +1,1 @@', '+first', '@@ -50,1 +50,1 @@', '+later'].join('\n')
    const kinds = parseDiffPreview(
      tool({ name: 'edit', argsPreview: JSON.stringify({ diff }) })
    ).map((line) => line.kind)

    expect(kinds).toEqual(['add', 'gap', 'add'])
  })

  it('treats whole-file contents as an addition from line one', () => {
    const lines = parseDiffPreview(
      tool({ name: 'edit', argsPreview: JSON.stringify({ path: 'n.ts', contents: 'a\nb\n' }) })
    )

    expect(lines).toEqual([
      { kind: 'add', text: 'a', lineNumber: 1 },
      { kind: 'add', text: 'b', lineNumber: 2 }
    ])
  })

  it('returns nothing when the arguments never arrived', () => {
    expect(parseDiffPreview(tool({ name: 'edit' }))).toEqual([])
  })

  it('flattens multi_edit edits[] into a preview body', () => {
    const lines = parseDiffPreview(
      tool({
        name: 'multi_edit',
        argsPreview: JSON.stringify({
          edits: [
            { path: 'api/page.tsx', contents: '"use client"\n' },
            { path: 'api/layout.tsx', contents: 'export default function Layout() {}\n' }
          ]
        })
      })
    )

    expect(lines[0]).toEqual({ kind: 'context', text: 'api/page.tsx', lineNumber: null })
    expect(lines.some((line) => line.kind === 'add' && line.text.includes('use client'))).toBe(true)
    expect(lines.some((line) => line.kind === 'gap')).toBe(true)
    expect(lines.some((line) => line.kind === 'context' && line.text === 'api/layout.tsx')).toBe(
      true
    )
  })
})

describe('fileBadge', () => {
  it('marks a file with its extension', () => {
    expect(fileBadge('src/features/chat/ChatView.tsx')).toBe('tsx')
    expect(fileBadge('C:\\ws\\styles.css')).toBe('css')
  })

  it('shortens extensions that are spelled out', () => {
    expect(fileBadge('a.javascript')).toBe('js')
    expect(fileBadge('notes.markdown')).toBe('md')
  })

  it('declines when there is nothing useful to show', () => {
    expect(fileBadge('Makefile')).toBeNull()
    expect(fileBadge('.gitignore')).toBeNull()
    expect(fileBadge('archive.backup2024')).toBeNull()
  })
})
