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
    { path: 'src/a.ts', status: 'modified', added: 10, removed: 4, binary: false },
    { path: 'src/b.ts', status: 'untracked', added: 7, removed: 0, binary: false }
  ],
  fileCount: 2,
  added: 17,
  removed: 4
}

/** Both pieces of chrome share one hook, exactly as the chat view wires them. */
function Harness({ workspacePath = '/ws' }: { workspacePath?: string | null }) {
  const chrome = useGitChrome(workspacePath, 0)
  return (
    <>
      <GitChangePills chrome={chrome} />
      <GitBranchStrip chrome={chrome} />
    </>
  )
}

function mockApi(overrides: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    gitStatus: vi.fn().mockResolvedValue({ ok: true, data: dirty }),
    gitCommit: vi.fn().mockResolvedValue({
      ok: true,
      data: { committed: true, pushed: false, detail: 'Committed' }
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

  it('renders nothing when the workspace is not a repository', async () => {
    mockApi({ gitStatus: vi.fn().mockResolvedValue({ ok: true, data: null }) })
    const { container } = render(<Harness />)

    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('keeps the branch but drops the change pills on a clean tree', async () => {
    mockApi({ gitStatus: vi.fn().mockResolvedValue({ ok: true, data: clean }) })
    render(<Harness />)

    expect(await screen.findByText('main')).toBeTruthy()
    expect(screen.queryByText('Changes')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Write a commit message' })).toBeNull()
  })

  it('commits with the message the user typed', async () => {
    const api = mockApi()
    render(<Harness />)

    fireEvent.click(await screen.findByRole('button', { name: 'Write a commit message' }))
    fireEvent.change(screen.getByLabelText('Commit message'), {
      target: { value: 'Tidy the router' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

    await waitFor(() => expect(api.gitCommit).toHaveBeenCalledWith('/ws', 'Tidy the router', false))
  })

  it('pushes only when asked', async () => {
    const api = mockApi()
    render(<Harness />)

    fireEvent.click(await screen.findByRole('button', { name: 'Write a commit message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit & Push' }))

    await waitFor(() => expect(api.gitCommit).toHaveBeenCalledWith('/ws', 'Update 2 files', true))
  })

  it('hides the push action when there is no remote', async () => {
    mockApi({
      gitStatus: vi.fn().mockResolvedValue({ ok: true, data: { ...dirty, hasRemote: false } })
    })
    render(<Harness />)

    fireEvent.click(await screen.findByRole('button', { name: 'Write a commit message' }))
    expect(screen.queryByRole('button', { name: 'Commit & Push' })).toBeNull()
  })

  it('surfaces a refusal from git instead of pretending it worked', async () => {
    mockApi({
      gitCommit: vi.fn().mockResolvedValue({ ok: false, error: 'Author identity unknown' })
    })
    render(<Harness />)

    fireEvent.click(await screen.findByRole('button', { name: 'Write a commit message' }))
    const input = screen.getByRole('textbox', { name: 'Commit message' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Author identity unknown')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Commit message' }) as HTMLInputElement).value).toBe(
      'Keep this draft'
    )
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
