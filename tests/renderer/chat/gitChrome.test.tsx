/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  GitBranchStrip,
  GitChangePills,
  useGitChrome
} from '@renderer/features/chat/components/GitChrome'
import type { GitStatus } from '@shared/ipc'

const clean: GitStatus = {
  branch: 'main',
  files: [],
  truncated: false,
  fileCount: 0,
  added: 0,
  removed: 0,
  hasRemote: true,
  hasCommits: true
}

const dirty: GitStatus = {
  ...clean,
  files: [
    {
      path: 'src/a.ts',
      status: 'modified',
      added: 10,
      removed: 4,
      addedStaged: 0,
      removedStaged: 0,
      addedUnstaged: 10,
      removedUnstaged: 4,
      binary: false,
      staged: false,
      unstaged: true
    },
    {
      path: 'src/b.ts',
      status: 'untracked',
      added: 7,
      removed: 0,
      addedStaged: 0,
      removedStaged: 0,
      addedUnstaged: 7,
      removedUnstaged: 0,
      binary: false,
      staged: false,
      unstaged: true
    }
  ],
  fileCount: 2,
  added: 17,
  removed: 4
}

/** Both pieces of chrome share one hook, exactly as the chat view wires them. */
function Harness({
  workspacePath = '/ws',
  onOpenChanges
}: {
  workspacePath?: string | null
  onOpenChanges?: () => void
}) {
  // Non-zero revision skips the production startup defer (revision === 0).
  const chrome = useGitChrome(workspacePath, 1)
  return (
    <>
      <GitChangePills chrome={chrome} onOpenChanges={onOpenChanges} />
      <GitBranchStrip chrome={chrome} />
    </>
  )
}

function mockApi(overrides: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    gitStatus: vi.fn().mockResolvedValue({ ok: true, data: { kind: 'ok', status: dirty } }),
    gitCommit: vi.fn().mockResolvedValue({
      ok: true,
      data: { committed: true, pushed: false, detail: 'Committed' }
    }),
    gitStageAll: vi.fn().mockResolvedValue({
      ok: true,
      data: { staged: true, detail: 'Staged all changes' }
    }),
    ...overrides
  } as Record<string, ReturnType<typeof vi.fn>>
  Object.defineProperty(window, 'vyotiq', { configurable: true, writable: true, value: api })
  return api
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  mockApi()
})

describe('git chrome', () => {
  it('shows the branch below and the size of the change above', async () => {
    render(<Harness />)

    expect(await screen.findByText('main')).toBeTruthy()
    expect(screen.getByText('Changes')).toBeTruthy()
    expect(screen.getByText('+17')).toBeTruthy()
    expect(screen.getByText('-4')).toBeTruthy()
  })

  it('opens Changes when the compact pill is clicked', async () => {
    const onOpenChanges = vi.fn()
    render(<Harness onOpenChanges={onOpenChanges} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open Changes panel' }))
    expect(onOpenChanges).toHaveBeenCalled()
  })

  it('renders nothing when the workspace is not a repository', async () => {
    mockApi({ gitStatus: vi.fn().mockResolvedValue({ ok: true, data: { kind: 'not_repo' } }) })
    const { container } = render(<Harness />)

    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('keeps the branch but drops the change pills on a clean tree', async () => {
    mockApi({ gitStatus: vi.fn().mockResolvedValue({ ok: true, data: { kind: 'ok', status: clean } }) })
    render(<Harness />)

    expect(await screen.findByText('main')).toBeTruthy()
    expect(screen.queryByText('Changes')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Changes panel' })).toBeNull()
  })

  it('re-reads git when asked', async () => {
    const api = mockApi()
    render(<Harness />)

    await screen.findByText('main')
    expect(api.gitStatus).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh git status' }))
    await waitFor(() => expect(api.gitStatus).toHaveBeenCalledTimes(2))
  })
})
