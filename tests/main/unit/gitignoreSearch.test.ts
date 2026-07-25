import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gitignoreMatcherForDir, loadGitignore } from '@main/agent/tools/gitignore'
import { toolSearch } from '@main/agent/tools/search'

describe('gitignore-aware search', () => {
  it('skips paths matched by root .gitignore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vyotiq-gitignore-'))
    mkdirSync(join(dir, 'src'))
    mkdirSync(join(dir, 'ignored'))
    writeFileSync(join(dir, 'src', 'keep.ts'), 'export const keep = true\n', 'utf8')
    writeFileSync(join(dir, 'ignored', 'skip.ts'), 'export const skip = true\n', 'utf8')
    writeFileSync(join(dir, '.gitignore'), 'ignored/\n', 'utf8')

    const matcher = loadGitignore(dir)
    expect(matcher.shouldIgnoreEntry('ignored', true)).toBe(true)

    const hits = await toolSearch(dir, 'export', 40)
    expect(hits).toMatch(/keep\.ts/)
    expect(hits).not.toMatch(/skip\.ts/)
  })

  it('applies nested .gitignore files relative to their directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vyotiq-gitignore-nested-'))
    mkdirSync(join(dir, 'src', 'generated'), { recursive: true })
    mkdirSync(join(dir, 'src', 'lib'))
    writeFileSync(join(dir, 'src', 'generated', 'auto.ts'), 'export const auto = 1\n', 'utf8')
    writeFileSync(join(dir, 'src', 'lib', 'hand.ts'), 'export const hand = 1\n', 'utf8')
    writeFileSync(join(dir, 'src', '.gitignore'), 'generated/\n', 'utf8')

    const srcMatcher = gitignoreMatcherForDir(dir, 'src')
    expect(srcMatcher.shouldIgnoreEntry('generated', true)).toBe(true)
    expect(srcMatcher.shouldIgnoreEntry('lib', true)).toBe(false)

    const hits = await toolSearch(dir, 'export', 40)
    expect(hits).toMatch(/hand\.ts/)
    expect(hits).not.toMatch(/auto\.ts/)
  })
})
