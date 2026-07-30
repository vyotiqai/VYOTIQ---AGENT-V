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
              binary: false
            },
            {
              path: 'gone.ts',
              status: 'deleted',
              added: 0,
              removed: 4,
              binary: false
            },
            {
              path: 'new.ts',
              status: 'untracked',
              added: 2,
              removed: 0,
              binary: false
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
          body: 'Hello',
          additions: 10,
          deletions: 2,
          files: [{ path: 'a.ts', additions: 10, deletions: 2 }],
          commits: [{ oid: 'abc1234', messageHeadline: 'feat', authors: ['dev'] }],
          checks: [{ name: 'ci', state: 'SUCCESS', conclusion: 'SUCCESS' }]
        }
      }),
      prMerge: vi.fn().mockResolvedValue({ ok: true, data: { detail: 'merged' } })
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
    expect(await screen.findByText('src/a.ts')).toBeTruthy()
    expect(screen.getByText('Commit & Push')).toBeTruthy()
  })

  it('includes deleted files in Staged scope and excludes untracked', async () => {
    render(<ChangesPanel items={[]} workspacePath="/ws" />)
    await screen.findByText('src/a.ts')
    fireEvent.click(screen.getByRole('button', { name: /Uncommitted/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Staged$/i }))
    expect(await screen.findByText('gone.ts')).toBeTruthy()
    expect(screen.queryByText('new.ts')).toBeNull()
  })

  it('passes staged:true to gitDiff when expanded under Staged scope', async () => {
    render(<ChangesPanel items={[]} workspacePath="/ws" />)
    await screen.findByText('src/a.ts')
    fireEvent.click(screen.getByRole('button', { name: /Uncommitted/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Staged$/i }))
    const row = await screen.findByText('src/a.ts')
    fireEvent.click(row)
    await waitFor(() => {
      expect(window.vyotiq.gitDiff).toHaveBeenCalledWith({
        workspacePath: '/ws',
        path: 'src/a.ts',
        staged: true
      })
    })
  })

  it('primary Commit & Push sends push:true after composing', async () => {
    render(<ChangesPanel items={[]} workspacePath="/ws" />)
    await screen.findByText('src/a.ts')
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
    const onCloseDock = vi.fn()
    render(
      <DockTabBar
        active="changes"
        tabs={[defaultDockTab('changes'), defaultDockTab('terminal')]}
        onSelect={onSelect}
        onCloseDock={onCloseDock}
        onOpenPanel={onOpenPanel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Terminal$/i }))
    expect(onSelect).toHaveBeenCalledWith('terminal')
    fireEvent.click(screen.getByRole('button', { name: /Open panel/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Browser/i }))
    expect(onOpenPanel).toHaveBeenCalledWith('browser')
    fireEvent.click(screen.getByRole('button', { name: /Close panel/i }))
    expect(onCloseDock).toHaveBeenCalled()
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

  it('calls prMerge for Squash & Merge', async () => {
    render(<PrPanel workspacePath="/ws" />)
    await screen.findByText(/feat: panels/)
    fireEvent.click(screen.getByRole('button', { name: /Squash & Merge/i }))
    expect(window.vyotiq.prMerge).toHaveBeenCalledWith('/ws', 'squash')
  })
})
