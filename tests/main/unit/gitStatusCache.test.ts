import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatus } from '@shared/ipc'

const readGitStatus = vi.hoisted(() =>
  vi.fn(async (_cwd: string): Promise<GitStatus | null> => ({
    branch: 'main',
    files: [],
    truncated: false,
    fileCount: 0,
    added: 0,
    removed: 0,
    hasRemote: false,
    hasCommits: true
  }))
)

vi.mock('@main/git/git', () => ({
  readGitStatus
}))

import {
  invalidateGitStatusCache,
  readGitStatusCached,
  resetGitStatusCacheForTests
} from '@main/git/gitStatusCache'

describe('gitStatusCache', () => {
  beforeEach(() => {
    resetGitStatusCacheForTests()
    readGitStatus.mockClear()
  })

  afterEach(() => {
    resetGitStatusCacheForTests()
  })

  it('coalesces overlapping reads into one shell-out', async () => {
    const [a, b] = await Promise.all([
      readGitStatusCached('C:/repo'),
      readGitStatusCached('C:/repo')
    ])
    expect(a?.branch).toBe('main')
    expect(b?.branch).toBe('main')
    expect(readGitStatus).toHaveBeenCalledTimes(1)
  })

  it('serves a short TTL hit without another shell-out', async () => {
    await readGitStatusCached('C:/repo')
    await readGitStatusCached('C:/repo')
    expect(readGitStatus).toHaveBeenCalledTimes(1)
  })

  it('invalidates so the next read shells out again', async () => {
    await readGitStatusCached('C:/repo')
    invalidateGitStatusCache('C:/repo')
    await readGitStatusCached('C:/repo')
    expect(readGitStatus).toHaveBeenCalledTimes(2)
  })

  it('does not re-cache a pre-invalidate inflight result', async () => {
    let resolveFirst!: (value: GitStatus | null) => void
    readGitStatus.mockImplementationOnce(
      () =>
        new Promise<GitStatus | null>((resolve) => {
          resolveFirst = resolve
        })
    )
    readGitStatus.mockResolvedValue({
      branch: 'fresh',
      files: [],
      truncated: false,
      fileCount: 0,
      added: 0,
      removed: 0,
      hasRemote: false,
      hasCommits: true
    })

    const first = readGitStatusCached('C:/repo')
    invalidateGitStatusCache('C:/repo')
    const second = readGitStatusCached('C:/repo')
    resolveFirst({
      branch: 'stale',
      files: [],
      truncated: false,
      fileCount: 0,
      added: 0,
      removed: 0,
      hasRemote: false,
      hasCommits: true
    })
    await expect(first).resolves.toMatchObject({ branch: 'stale' })
    await expect(second).resolves.toMatchObject({ branch: 'fresh' })
    // TTL hit must serve the post-invalidate result, not the stale inflight write.
    await expect(readGitStatusCached('C:/repo')).resolves.toMatchObject({ branch: 'fresh' })
    expect(readGitStatus).toHaveBeenCalledTimes(2)
  })
})
