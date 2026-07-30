import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  collectRecentReceipts,
  summarizeWeaknesses,
  writeHarnessProposal,
  runHarnessReview,
  loadSubagentReports,
  parseSubagentReportMarkdown
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
    contractDoneWhen: {
      mode: 'require',
      nudged: false,
      checkableCriteria: 0
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

  it('collects and summarizes receipts into a proposal file', async () => {
    const sessions = workspaceSessionsRoot(workspace)
    const runDir = join(sessions, 'run-a')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, RUN_RECEIPT_FILENAME), JSON.stringify(sampleReceipt()), 'utf8')

    const collected = collectRecentReceipts(workspace, { limit: 10 })
    expect(collected).toHaveLength(1)
    expect(collected[0]?.runId).toBe('run-a')

    const summary = summarizeWeaknesses(collected)
    expect(summary.receiptCount).toBe(1)
    expect(summary.bullets.some((b) => /Unread-before-edit/.test(b))).toBe(true)
    expect(summary.bullets.some((b) => /Recurring failure/.test(b))).toBe(true)
    expect(summary.evidenceBuckets.some((b) => b.component === 'loop_notices')).toBe(true)
    expect(summary.evidenceBuckets.some((b) => b.component === 'tool_policy')).toBe(true)
    expect(summary.evidenceBuckets.some((b) => b.component === 'verify')).toBe(true)
    expect(summary.evidenceBuckets.some((b) => b.component === 'system_prompt')).toBe(true)

    // Provide a harness so the proposal includes a Proposed harness body.
    mkdirSync(join(workspace, 'resources', 'harness'), { recursive: true })
    writeFileSync(
      join(workspace, 'resources', 'harness', 'default.md'),
      '# Agent V\n\n## Work style\n\nx\n',
      'utf8'
    )

    const written = writeHarnessProposal(workspace, summary)
    expect(written.relativePath).toMatch(/^\.vyotiq\/harness\/proposals\//)
    expect(existsSync(written.proposalPath)).toBe(true)
    const body = readFileSync(written.proposalPath, 'utf8')
    expect(body).toMatch(/Suggested harness edits/)
    expect(body).toMatch(/Proposed harness body/)
    expect(body).toMatch(/Receipt review notes/)
    expect(body).toMatch(/## Evidence buckets/)
    expect(body).toMatch(/not unsupervised Self-Harness/)
    expect(body).toMatch(/writes only `resources\/harness\/default\.md`/)
    expect(body).toMatch(/runReceipt\.test\.ts/)

    const result = await runHarnessReview(workspace)
    expect(result.receiptCount).toBe(1)
    expect(existsSync(result.proposalPath)).toBe(true)
  })

  it('mines subagent report.md into evidence buckets', async () => {
    const sessions = workspaceSessionsRoot(workspace)
    const runDir = join(sessions, 'run-a')
    const subDir = join(runDir, 'subagents', 'abc123')
    mkdirSync(subDir, { recursive: true })
    writeFileSync(
      join(runDir, RUN_RECEIPT_FILENAME),
      JSON.stringify(
        sampleReceipt({
          failureClusters: [],
          unreadEditPaths: [],
          toolStats: { totalCalls: 1, ok: 1, failed: 0, byName: { subagent: { ok: 1, failed: 0 } } },
          verifyBeforeDone: { mode: 'notice', nudged: false, victoryClaimWithoutTools: false },
          subagents: [{ id: 'abc123', status: 'failed', reportPath: 'subagents/abc123/report.md' }]
        })
      ),
      'utf8'
    )
    writeFileSync(
      join(subDir, 'report.md'),
      ['# Sub-agent report', '', 'ok: false', 'steps: 9', '', '## Task', '', 'Find the bug', '', '## Report', '', 'Unable to locate the issue', ''].join(
        '\n'
      ),
      'utf8'
    )

    const collected = collectRecentReceipts(workspace)
    const reports = loadSubagentReports(workspace, collected)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.ok).toBe(false)
    expect(reports[0]?.steps).toBe(9)

    const parsed = parseSubagentReportMarkdown('x', reports[0] ? readFileSync(join(subDir, 'report.md'), 'utf8') : '')
    expect(parsed.report).toMatch(/Unable/)

    const summary = summarizeWeaknesses(collected, reports)
    expect(summary.subagentEvidence.some((b) => /failed sub-agent/i.test(b))).toBe(true)
    expect(summary.bullets.some((b) => /uncertainty/i.test(b))).toBe(true)
    expect(summary.evidenceBuckets.some((b) => b.component === 'tool_policy')).toBe(true)
    expect(summary.evidenceBuckets.some((b) => b.component === 'memory')).toBe(true)

    mkdirSync(join(workspace, 'resources', 'harness'), { recursive: true })
    writeFileSync(join(workspace, 'resources', 'harness', 'default.md'), '# Agent V\n', 'utf8')
    const written = writeHarnessProposal(workspace, summary)
    const body = readFileSync(written.proposalPath, 'utf8')
    expect(body).toMatch(/## Sub-agent evidence/)
  })

  it('uses rewriteBody when provided and marks LLM-assisted', async () => {
    const sessions = workspaceSessionsRoot(workspace)
    const runDir = join(sessions, 'run-b')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, RUN_RECEIPT_FILENAME),
      JSON.stringify(
        sampleReceipt({
          runId: 'run-b',
          failureClusters: [],
          unreadEditPaths: [],
          verifyBeforeDone: { mode: 'notice', nudged: false, victoryClaimWithoutTools: false }
        })
      ),
      'utf8'
    )
    mkdirSync(join(workspace, 'resources', 'harness'), { recursive: true })
    writeFileSync(join(workspace, 'resources', 'harness', 'default.md'), '# Agent V\nold\n', 'utf8')

    const result = await runHarnessReview(workspace, {
      rewriteBody: async () => ({ body: '# Agent V\n\nrewritten-by-llm\n', usedLlm: true })
    })
    const body = readFileSync(result.proposalPath, 'utf8')
    expect(body).toMatch(/LLM-assisted proposal/)
    expect(body).toMatch(/rewritten-by-llm/)
  })
})
