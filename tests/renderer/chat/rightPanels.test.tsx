/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChangesPanel } from '@renderer/features/chat/components/ChangesPanel'
import { DockTabBar, defaultDockTab } from '@renderer/features/chat/components/DockTabBar'
import { PrPanel } from '@renderer/features/chat/components/PrPanel'

beforeEach(() => {
  Object.defineProperty(window, 'vyotiq', {
    configurable: true,
    writable: true,
    value: {
      gitStatus: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          branch: 'main',
          files: [
            {
              path: 'src/a.ts',
              status: 'modified',
              added: 3,
              removed: 1,
              binary: false,
              staged: true,
              unstaged: true
            },
            {
              path: 'gone.ts',
              status: 'deleted',
              added: 0,
              removed: 4,
              binary: false,
              staged: true,
              unstaged: false
            },
            {
              path: 'new.ts',
              status: 'untracked',
              added: 2,
              removed: 0,
              binary: false,
              staged: false,
              unstaged: true
            }
          ],
          truncated: false,
          fileCount: 3,
          added: 5,
          removed: 5,
          hasRemote: true,
          hasCommits: true
        }
      }),
      gitCommit: vi.fn().mockResolvedValue({
        ok: true,
        data: { committed: true, pushed: true, detail: 'pushed' }
      }),
      gitLog: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          {
            sha: 'abc1234567890',
            shortSha: 'abc1234',
            subject: 'first',
            author: 'dev',
            relativeDate: '1 day ago'
          }
        ]
      }),
      gitCommitFiles: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          files: [
            {
              path: 'src/a.ts',
              status: 'modified',
              added: 1,
              removed: 0,
              binary: false,
              staged: false,
              unstaged: false
            }
          ]
        }
      }),
      gitDiff: vi.fn().mockResolvedValue({
        ok: true,
        data: { content: '@@ -1 +1 @@\n-old\n+new\n' }
      }),
      prView: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          number: 10,
          title: 'feat: panels',
          url: 'https://github.com/ex/repo/pull/10',
          state: 'OPEN',
          baseRefName: 'main',
          headRefName: 'feat/panels',
          baseRefOid: 'aaa',
          headRefOid: 'bbb',
          body: 'Hello',
          additions: 10,
          deletions: 2,
          files: [{ path: 'a.ts', additions: 10, deletions: 2, changeType: 'MODIFIED' }],
          commits: [{ oid: 'abc1234', messageHeadline: 'feat', authors: ['dev'] }],
          checks: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }],
          reviews: [],
          latestReviews: [],
          reviewDecision: '',
          reviewRequests: []
        }
      }),
      prMerge: vi.fn().mockResolvedValue({ ok: true, data: { detail: 'merged' } }),
      prDiff: vi.fn().mockResolvedValue({
        ok: true,
        data: { content: '@@ -1 +1 @@\n-old\n+new\n' }
      }),
      prClose: vi.fn().mockResolvedValue({ ok: true, data: { detail: 'closed' } }),
      prEditTitle: vi.fn().mockResolvedValue({ ok: true, data: { title: 'feat: panels' } })
    }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChangesPanel', () => {
  it('renders git dirty files from gitStatus', async () => {
    render(<ChangesPanel items={[]} workspacePath="/ws" />)
    expect(await screen.findByText('a.ts')).toBeTruthy()
    expect(screen.getByText('Commit & Push')).toBeTruthy()
  })

  it('includes deleted files in Staged scope and excludes untracked', async () => {
    render(<ChangesPanel items={[]} workspacePath="/ws" />)
    await screen.findByText('a.ts')
    fireEvent.click(screen.getByRole('button', { name: /Uncommitted/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Staged/i }))
    expect(await screen.findByText('gone.ts')).toBeTruthy()
    expect(screen.queryByText('new.ts')).toBeNull()
  })

  it('passes staged:true to gitDiff when expanded under Staged scope', async () => {
    render(<ChangesPanel items={[]} workspacePath="/ws" />)
    await screen.findByText('a.ts')
    fireEvent.click(screen.getByRole('button', { name: /Uncommitted/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Staged/i }))
    const row = await screen.findByText('a.ts')
    fireEvent.click(row)
    await waitFor(() => {
      expect(window.vyotiq.gitDiff).toHaveBeenCalledWith({
        workspacePath: '/ws',
        path: 'src/a.ts',
        staged: true,
        ignoreWhitespace: false,
        sha: undefined
      })
    })
  })

  it('exposes Layout, Ignore Whitespace, and Find in the more menu', async () => {
    render(<ChangesPanel items={[]} workspacePath="/ws" />)
    await screen.findByText('a.ts')
    fireEvent.click(screen.getByRole('button', { name: /More changes actions/i }))
    expect(screen.getByText(/Layout/i)).toBeTruthy()
    expect(screen.getByRole('switch', { name: /Ignore Whitespace/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Find in Changes/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Find in Changes/i }))
    expect(screen.getByRole('searchbox', { name: /Find in changes/i })).toBeTruthy()
  })

  it('lists commits from gitLog under Commits scope', async () => {
    render(<ChangesPanel items={[]} workspacePath="/ws" />)
    await screen.findByText('a.ts')
    fireEvent.click(screen.getByRole('button', { name: /Uncommitted/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Commits/i }))
    expect(await screen.findByText('first')).toBeTruthy()
    expect(window.vyotiq.gitLog).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /All Commits/i })).toBeTruthy()
  })

  it('primary Commit & Push sends push:true after composing', async () => {
    render(<ChangesPanel items={[]} workspacePath="/ws" />)
    await screen.findByText('a.ts')
    fireEvent.click(screen.getByRole('button', { name: /^Commit & Push$/i }))
    const input = await screen.findByRole('textbox', { name: /Commit message/i })
    fireEvent.change(input, { target: { value: 'ship it' } })
    fireEvent.click(screen.getByRole('button', { name: /^Commit & Push$/i }))
    await waitFor(() => {
      expect(window.vyotiq.gitCommit).toHaveBeenCalledWith('/ws', 'ship it', true)
    })
  })
})

describe('DockTabBar', () => {
  it('selects tabs and opens missing panels from the add menu', () => {
    const onSelect = vi.fn()
    const onOpenPanel = vi.fn()
    const onCloseTab = vi.fn()
    const onToggleExpanded = vi.fn()
    render(
      <DockTabBar
        active="changes"
        tabs={[defaultDockTab('changes'), defaultDockTab('terminal')]}
        onSelect={onSelect}
        onCloseTab={onCloseTab}
        onOpenPanel={onOpenPanel}
        expanded={false}
        onToggleExpanded={onToggleExpanded}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Terminal$/i }))
    expect(onSelect).toHaveBeenCalledWith('terminal')
    fireEvent.click(screen.getByRole('button', { name: /Open panel/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Browser/i }))
    expect(onOpenPanel).toHaveBeenCalledWith('browser')
    fireEvent.click(screen.getByRole('button', { name: /Close ± Changes/i }))
    expect(onCloseTab).toHaveBeenCalledWith('changes')
    fireEvent.click(screen.getByRole('button', { name: /Expand panel/i }))
    expect(onToggleExpanded).toHaveBeenCalled()
  })
})

describe('PrPanel', () => {
  it('renders PR metadata from gh view', async () => {
    const onPrMeta = vi.fn()
    render(<PrPanel workspacePath="/ws" onPrMeta={onPrMeta} />)
    expect(await screen.findByText(/feat: panels/)).toBeTruthy()
    expect(screen.getByText(/feat\/panels → main/)).toBeTruthy()
    expect(onPrMeta).toHaveBeenCalledWith({ number: 10, title: 'feat: panels' })
  })

  it('does not re-fetch when only onPrMeta identity changes', async () => {
    const { rerender } = render(
      <PrPanel workspacePath="/ws" onPrMeta={() => undefined} />
    )
    await screen.findByText(/feat: panels/)
    const calls = (window.vyotiq.prView as ReturnType<typeof vi.fn>).mock.calls.length
    rerender(<PrPanel workspacePath="/ws" onPrMeta={() => undefined} />)
    await waitFor(() => {
      expect((window.vyotiq.prView as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
    })
  })

  it('calls prMerge for Squash & Merge', async () => {
    render(<PrPanel workspacePath="/ws" />)
    await screen.findByText(/feat: panels/)
    expect(screen.getByText('Open')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Squash & Merge/i }))
    expect(window.vyotiq.prMerge).toHaveBeenCalledWith('/ws', 'squash')
  })

  it('exposes Reviews tab and expandable file diffs with viewed checkbox', async () => {
    render(<PrPanel workspacePath="/ws" />)
    await screen.findByText(/feat: panels/)
    expect(screen.getByRole('button', { name: /^Reviews/i })).toBeTruthy()
    fireEvent.click(screen.getByText('a.ts'))
    await waitFor(() => {
      expect(window.vyotiq.prDiff).toHaveBeenCalledWith({
        workspacePath: '/ws',
        path: 'a.ts',
        ignoreWhitespace: false
      })
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /Mark a\.ts as viewed/i }))
    expect(
      (screen.getByRole('checkbox', { name: /Mark a\.ts as viewed/i }) as HTMLInputElement).checked
    ).toBe(true)
  })

  it('shows Expand All, Find in Diff, Edit Title, Close PR, Unlink PR in ··· menu', async () => {
    const onUnlink = vi.fn()
    render(<PrPanel workspacePath="/ws" onUnlink={onUnlink} />)
    await screen.findByText(/feat: panels/)
    fireEvent.click(screen.getByRole('button', { name: /PR actions/i }))
    expect(screen.getByRole('button', { name: /Expand All Files/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Find in Diff/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Edit Title/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Close PR/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Unlink PR/i }))
    expect(onUnlink).toHaveBeenCalled()
  })
})
