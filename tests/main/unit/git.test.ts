import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { commitAll, isGitRepo, readGitStatus, stageAll } from '@main/git/git'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('git status', () => {
  let repo: string
  let plain: string

  beforeAll(() => {
    plain = mkdtempSync(join(tmpdir(), 'vyotiq-plain-'))

    repo = mkdtempSync(join(tmpdir(), 'vyotiq-git-'))
    git(repo, 'init', '--initial-branch=main')
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'kept.txt'), 'one\ntwo\nthree\n', 'utf8')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-m', 'first')
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(plain, { recursive: true, force: true })
  })

  it('reports nothing for a directory that is not a repository', async () => {
    expect(isGitRepo(plain)).toBe(false)
    expect(await readGitStatus(plain)).toBeNull()
  })

  it('reports a clean repository with its branch', async () => {
    const status = await readGitStatus(repo)
    expect(status?.branch).toBe('main')
    expect(status?.files).toEqual([])
    expect(status?.added).toBe(0)
    expect(status?.hasCommits).toBe(true)
  })

  it('counts added and removed lines for a tracked edit', async () => {
    writeFileSync(join(repo, 'kept.txt'), 'one\ntwo\nthree\nfour\n', 'utf8')
    const status = await readGitStatus(repo)
    const file = status?.files.find((entry) => entry.path === 'kept.txt')
    expect(file).toMatchObject({
      status: 'modified',
      added: 1,
      removed: 0,
      addedUnstaged: 1,
      removedUnstaged: 0,
      addedStaged: 0,
      removedStaged: 0,
      staged: false,
      unstaged: true
    })
    expect(status?.added).toBe(1)
  })

  it('counts an untracked file as wholly added', async () => {
    mkdirSync(join(repo, 'sub'), { recursive: true })
    writeFileSync(join(repo, 'sub', 'new.txt'), 'a\nb\n', 'utf8')
    const status = await readGitStatus(repo)
    const file = status?.files.find((entry) => entry.path === 'sub/new.txt')
    expect(file).toMatchObject({
      status: 'untracked',
      added: 2,
      removed: 0,
      addedUnstaged: 2,
      staged: false,
      unstaged: true
    })
  })

  it('splits partially staged line deltas per side', async () => {
    writeFileSync(join(repo, 'kept.txt'), 'staged-line\nworktree-line\n', 'utf8')
    git(repo, 'add', 'kept.txt')
    writeFileSync(join(repo, 'kept.txt'), 'staged-line\nworktree-line\nextra\n', 'utf8')
    const status = await readGitStatus(repo)
    const file = status?.files.find((entry) => entry.path === 'kept.txt')
    expect(file).toMatchObject({
      staged: true,
      unstaged: true
    })
    expect((file?.addedStaged ?? 0) + (file?.removedStaged ?? 0)).toBeGreaterThan(0)
    expect((file?.addedUnstaged ?? 0) + (file?.removedUnstaged ?? 0)).toBeGreaterThan(0)
  })

  it('marks staged-only index changes via porcelain XY', async () => {
    writeFileSync(join(repo, 'kept.txt'), 'staged-only\n', 'utf8')
    git(repo, 'add', 'kept.txt')
    const status = await readGitStatus(repo)
    const file = status?.files.find((entry) => entry.path === 'kept.txt')
    expect(file).toMatchObject({ staged: true, unstaged: false })
  })

  it('stages all unstaged changes without committing', async () => {
    writeFileSync(join(repo, 'kept.txt'), 'to-stage\n', 'utf8')
    writeFileSync(join(repo, 'extra.txt'), 'x\n', 'utf8')
    const staged = await stageAll(repo)
    expect(staged.staged).toBe(true)
    const status = await readGitStatus(repo)
    expect(status?.files.every((f) => f.staged && !f.unstaged)).toBe(true)
  })

  it('commits staged content only when mode is staged', async () => {
    writeFileSync(join(repo, 'kept.txt'), 'index-version\n', 'utf8')
    git(repo, 'add', 'kept.txt')
    writeFileSync(join(repo, 'kept.txt'), 'index-version\nworktree-extra\n', 'utf8')
    const result = await commitAll(repo, 'staged-only', false, 'staged')
    expect(result.committed).toBe(true)
    const status = await readGitStatus(repo)
    const file = status?.files.find((entry) => entry.path === 'kept.txt')
    expect(file).toMatchObject({ staged: false, unstaged: true })
  })

  it('commits everything and reports what it did', async () => {
    const result = await commitAll(repo, 'second', false, 'all')
    expect(result).toMatchObject({ committed: true, pushed: false })

    const status = await readGitStatus(repo)
    expect(status?.files).toEqual([])
  })

  it('refuses to invent a commit when nothing changed', async () => {
    const result = await commitAll(repo, 'empty', false)
    expect(result.committed).toBe(false)
    expect(result.detail).toBe('Nothing to commit')
  })

  it('reports that a push had nowhere to go rather than failing', async () => {
    writeFileSync(join(repo, 'kept.txt'), 'one\n', 'utf8')
    const result = await commitAll(repo, 'third', true)
    expect(result).toMatchObject({ committed: true, pushed: false })
    expect(result.detail).toContain('No remote')
  })

  it('counts a deleted tracked file', async () => {
    writeFileSync(join(repo, 'doomed.txt'), 'bye\n', 'utf8')
    git(repo, 'add', 'doomed.txt')
    git(repo, 'commit', '-m', 'add doomed')
    rmSync(join(repo, 'doomed.txt'))
    const status = await readGitStatus(repo)
    const file = status?.files.find((entry) => entry.path === 'doomed.txt')
    expect(file).toMatchObject({ status: 'deleted', unstaged: true })
  })
})
