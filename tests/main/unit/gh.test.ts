import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileAsync } = vi.hoisted(() => ({
  execFileAsync: vi.fn()
}))

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>()
  return {
    ...actual,
    promisify: () => execFileAsync
  }
})

vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

import { ghAvailable, prMerge, prView } from '@main/git/gh'

describe('gh helpers', () => {
  beforeEach(() => {
    execFileAsync.mockReset()
  })

  it('ghAvailable is false when gh is missing', async () => {
    execFileAsync.mockRejectedValueOnce(new Error('not found'))
    await expect(ghAvailable()).resolves.toBe(false)
  })

  it('prView returns null when gh is unavailable', async () => {
    execFileAsync.mockRejectedValueOnce(new Error('not found'))
    await expect(prView('/ws')).resolves.toBeNull()
  })

  it('prView maps gh JSON into PrView', async () => {
    execFileAsync
      .mockResolvedValueOnce({ stdout: 'gh version 2.0', stderr: '' })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          number: 12,
          title: 'Dock WIP',
          url: 'https://example.com/pr/12',
          state: 'OPEN',
          baseRefName: 'main',
          headRefName: 'feat',
          body: 'notes',
          additions: 3,
          deletions: 1,
          files: [{ path: 'a.ts', additions: 3, deletions: 1 }],
          commits: [{ oid: 'abc', messageHeadline: 'wip', authors: [{ login: 'u' }] }],
          statusCheckRollup: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }]
        }),
        stderr: ''
      })
    const view = await prView('/ws')
    expect(view?.number).toBe(12)
    expect(view?.files[0]?.path).toBe('a.ts')
    expect(view?.commits[0]?.authors).toEqual(['u'])
    expect(view?.checks[0]?.name).toBe('ci')
  })

  it('prMerge throws when gh is missing', async () => {
    execFileAsync.mockRejectedValueOnce(new Error('not found'))
    await expect(prMerge('/ws', 'squash')).rejects.toThrow(/GitHub CLI/i)
  })
})
