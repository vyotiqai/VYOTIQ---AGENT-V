/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlanPanel } from '@renderer/features/chat/components/PlanPanel'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PlanPanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'vyotiq', {
      configurable: true,
      writable: true,
      value: {
        readRunArtifact: vi.fn()
      }
    })
  })

  it('shows empty contract state when runId is null without calling IPC', async () => {
    render(
      <PlanPanel workspacePath="/ws" runId={null} running={false} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'contract.md' }))

    await waitFor(() => {
      expect(screen.getByText('No contract yet')).toBeTruthy()
    })
    expect(screen.getByText('The run contract is created when a chat starts.')).toBeTruthy()
    expect(window.vyotiq.readRunArtifact).not.toHaveBeenCalled()
  })

  it('loads contract.md via readRunArtifact when workspace and run are set', async () => {
    window.vyotiq.readRunArtifact = vi.fn().mockResolvedValue({
      ok: true,
      data: { name: 'contract.md', exists: true, content: '## Goal\n\nShip it\n' }
    })

    render(
      <PlanPanel workspacePath="/ws" runId="run-1" running={false} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'contract.md' }))

    await waitFor(() => {
      expect(window.vyotiq.readRunArtifact).toHaveBeenCalledWith({
        workspacePath: '/ws',
        runId: 'run-1',
        name: 'contract.md'
      })
    })
    await waitFor(() => {
      expect(screen.getByText('Ship it')).toBeTruthy()
    })
  })

  it('loads plan.md on mount when draft is ready', async () => {
    window.vyotiq.readRunArtifact = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        name: 'plan.md',
        exists: true,
        content: '# Comprehensive plan\n\n## Goal\n\nAudit the app\n'
      }
    })

    render(
      <PlanPanel workspacePath="/ws" runId="run-2" running={false} />
    )

    await waitFor(() => {
      expect(window.vyotiq.readRunArtifact).toHaveBeenCalledWith({
        workspacePath: '/ws',
        runId: 'run-2',
        name: 'plan.md'
      })
    })
    await waitFor(() => {
      expect(screen.getByText('Audit the app')).toBeTruthy()
    })
  })

  it('loads and renders receipt.json summary', async () => {
    window.vyotiq.readRunArtifact = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        name: 'receipt.json',
        exists: true,
        content: JSON.stringify({
          version: 4,
          writtenAt: '2026-07-30T00:00:00.000Z',
          runId: 'run-3',
          status: 'done',
          step: 2,
          compactionCount: 0,
          toolStats: { totalCalls: 3, ok: 2, failed: 1, byName: {} },
          failureClusters: [{ key: 'edit: boom', count: 1 }],
          unreadEditPaths: ['x.ts'],
          wroteFiles: ['y.ts'],
          diagnostics: { calls: 0, ok: 0, clean: 0 },
          verifyBeforeDone: {
            mode: 'notice',
            nudged: true,
            victoryClaimWithoutTools: false
          },
          contractDoneWhen: {
            mode: 'require',
            nudged: false,
            checkableCriteria: 0
          },
          contractExcerpt: '',
          subagents: [
            { id: 'sa-1', status: 'ok', reportPath: 'subagents/sa-1/report.md' }
          ]
        })
      }
    })

    render(<PlanPanel workspacePath="/ws" runId="run-3" running={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'receipt.json' }))

    await waitFor(() => {
      expect(window.vyotiq.readRunArtifact).toHaveBeenCalledWith({
        workspacePath: '/ws',
        runId: 'run-3',
        name: 'receipt.json'
      })
    })
    await waitFor(() => {
      expect(screen.getByText(/3 calls/)).toBeTruthy()
      expect(screen.getByText('x.ts')).toBeTruthy()
      expect(screen.getByText('y.ts')).toBeTruthy()
      expect(screen.getByText(/sa-1 · ok/)).toBeTruthy()
    })
    expect(screen.getByLabelText('Receipt panel')).toBeTruthy()
  })

  it('ignores stale tab responses when switching tabs quickly', async () => {
    let resolvePlan: ((v: unknown) => void) | undefined
    const planPromise = new Promise((resolve) => {
      resolvePlan = resolve
    })
    window.vyotiq.readRunArtifact = vi.fn().mockImplementation(({ name }) => {
      if (name === 'plan.md') return planPromise
      return Promise.resolve({
        ok: true,
        data: { name: 'contract.md', exists: true, content: '## Goal\n\nContract win\n' }
      })
    })

    render(<PlanPanel workspacePath="/ws" runId="run-race" running={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'contract.md' }))

    await waitFor(() => {
      expect(screen.getByText('Contract win')).toBeTruthy()
    })

    resolvePlan?.({
      ok: true,
      data: {
        name: 'plan.md',
        exists: true,
        content: '# Comprehensive plan\n\n## Goal\n\nStale plan text\n'
      }
    })

    await waitFor(() => {
      expect(screen.queryByText('Stale plan text')).toBeNull()
      expect(screen.getByText('Contract win')).toBeTruthy()
    })
    expect(screen.getByLabelText('Contract panel')).toBeTruthy()
  })

  it('rejects invalid receipt.json via safeParse', async () => {
    window.vyotiq.readRunArtifact = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        name: 'receipt.json',
        exists: true,
        content: JSON.stringify({ version: 1, runId: 'bad' })
      }
    })

    render(<PlanPanel workspacePath="/ws" runId="run-bad" running={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'receipt.json' }))

    await waitFor(() => {
      expect(screen.getByText('Invalid receipt.json')).toBeTruthy()
    })
  })
})
