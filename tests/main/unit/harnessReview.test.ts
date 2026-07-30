import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  collectRecentReceipts,
  summarizeWeaknesses,
  writeHarnessProposal,
  runHarnessReview
} from '@main/agent/harnessReview'
import { RUN_RECEIPT_FILENAME, RUN_RECEIPT_VERSION } from '@main/agent/runReceipt'
import { workspaceSessionsRoot } from '@main/storage/paths'
import type { RunReceipt } from '@shared/ipc'

const userData = join(tmpdir(), `vyotiq-harness-review-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userData
      throw new Error(`unexpected getPath(${name})`)
    },
    getAppPath: () => '/tmp/vyotiq-app',
    isPackaged: false
  }
}))

function sampleReceipt(overrides?: Partial<RunReceipt>): RunReceipt {
  return {
    version: RUN_RECEIPT_VERSION,
    writtenAt: '2026-07-30T12:00:00.000Z',
    runId: 'run-a',
    status: 'done',
    step: 2,
    compactionCount: 0,
    toolStats: { totalCalls: 4, ok: 2, failed: 2, byName: { edit: { ok: 0, failed: 2 } } },
    failureClusters: [{ key: 'edit: ENOENT', count: 2 }],
    unreadEditPaths: ['src/foo.ts'],
    wroteFiles: ['src/foo.ts'],
    diagnostics: { calls: 0, ok: 0 },
    verifyBeforeDone: {
      mode: 'notice',
      nudged: true,
      victoryClaimWithoutTools: true
    },
    contractExcerpt: '## Done when',
    ...overrides
  }
}

describe('harnessReview', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-hr-ws-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    mkdirSync(userData, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
  })

  it('collects and summarizes receipts into a proposal file', () => {
    const sessions = workspaceSessionsRoot(workspace)
    const runDir = join(sessions, 'run-a')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, RUN_RECEIPT_FILENAME), JSON.stringify(sampleReceipt()), 'utf8')

    const collected = collectRecentReceipts(workspace, { limit: 10 })
    expect(collected).toHaveLength(1)
    expect(collected[0]?.runId).toBe('run-a')

    const summary = summarizeWeaknesses(collected)
    expect(summary.receiptCount).toBe(1)
    expect(summary.markdown).toMatch(/Harness proposal/)
    expect(summary.markdown).toMatch(/Unread-before-edit/)
    expect(summary.markdown).toMatch(/Recurring failure/)

    const written = writeHarnessProposal(workspace, summary)
    expect(written.relativePath).toMatch(/^\.vyotiq\/harness\/proposals\//)
    expect(existsSync(written.proposalPath)).toBe(true)
    expect(readFileSync(written.proposalPath, 'utf8')).toMatch(/Suggested harness edits/)

    const result = runHarnessReview(workspace)
    expect(result.receiptCount).toBe(1)
    expect(existsSync(result.proposalPath)).toBe(true)
  })
})
