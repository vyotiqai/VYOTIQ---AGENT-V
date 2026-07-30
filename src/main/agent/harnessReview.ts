import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import type { HarnessReviewResult, RunReceipt } from '../../shared/ipc'
import { RunReceiptSchema } from '../../shared/ipc'
import { resolveInsideWorkspace } from '../workspace/safePath'
import { workspaceSessionsRoot } from '../storage/paths'
import { RUN_RECEIPT_FILENAME } from './runReceipt'

const DEFAULT_LIMIT = 20

export type CollectedReceipt = {
  runId: string
  receipt: RunReceipt
}

/** Load recent receipt.json files from the workspace session store (AppData). */
export function collectRecentReceipts(
  workspacePath: string,
  opts?: { limit?: number }
): CollectedReceipt[] {
  const limit = Math.max(1, Math.min(100, opts?.limit ?? DEFAULT_LIMIT))
  const root = workspaceSessionsRoot(workspacePath)
  if (!existsSync(root)) return []

  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  const collected: Array<CollectedReceipt & { writtenAt: string }> = []
  for (const runId of dirs) {
    const receiptPath = join(root, runId, RUN_RECEIPT_FILENAME)
    if (!existsSync(receiptPath)) continue
    try {
      const raw: unknown = JSON.parse(readFileSync(receiptPath, 'utf8'))
      const parsed = RunReceiptSchema.safeParse(raw)
      if (!parsed.success) continue
      collected.push({
        runId,
        receipt: parsed.data,
        writtenAt: parsed.data.writtenAt
      })
    } catch {
      // skip corrupt receipts
    }
  }

  collected.sort((a, b) => b.writtenAt.localeCompare(a.writtenAt))
  return collected.slice(0, limit).map(({ runId, receipt }) => ({ runId, receipt }))
}

export type WeaknessSummary = {
  receiptCount: number
  bullets: string[]
  markdown: string
}

/** Rule-based weakness extraction from receipts (no LLM). */
export function summarizeWeaknesses(receipts: readonly CollectedReceipt[]): WeaknessSummary {
  const failureCounts = new Map<string, number>()
  const unreadCounts = new Map<string, number>()
  let victoryClaims = 0
  let verifyNudges = 0
  let highFailureStreaks = 0
  let toolFailTotal = 0
  let toolCallTotal = 0

  for (const { receipt } of receipts) {
    toolCallTotal += receipt.toolStats.totalCalls
    toolFailTotal += receipt.toolStats.failed
    for (const cluster of receipt.failureClusters) {
      failureCounts.set(cluster.key, (failureCounts.get(cluster.key) ?? 0) + cluster.count)
    }
    for (const path of receipt.unreadEditPaths) {
      unreadCounts.set(path, (unreadCounts.get(path) ?? 0) + 1)
    }
    if (receipt.verifyBeforeDone.victoryClaimWithoutTools) victoryClaims++
    if (receipt.verifyBeforeDone.nudged) verifyNudges++
    if ((receipt.consecutiveToolFailureSteps ?? 0) >= 3) highFailureStreaks++
  }

  const bullets: string[] = []
  bullets.push(`Mined ${receipts.length} run receipt(s).`)
  if (toolCallTotal > 0) {
    bullets.push(
      `Tool outcomes: ${toolFailTotal}/${toolCallTotal} failed (${Math.round((toolFailTotal / toolCallTotal) * 100)}%).`
    )
  }
  const topFailures = [...failureCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
  for (const [key, count] of topFailures) {
    bullets.push(`Recurring failure (${count}×): ${key}`)
  }
  const topUnread = [...unreadCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
  for (const [path, count] of topUnread) {
    bullets.push(`Unread-before-edit (${count}×): ${path}`)
  }
  if (victoryClaims > 0) {
    bullets.push(`${victoryClaims} run(s) claimed done without tools after last assistant turn.`)
  }
  if (verifyNudges > 0) {
    bullets.push(`${verifyNudges} run(s) received a verify-before-done nudge.`)
  }
  if (highFailureStreaks > 0) {
    bullets.push(`${highFailureStreaks} run(s) had consecutive tool-failure streaks ≥ 3.`)
  }
  if (bullets.length === 1) {
    bullets.push('No strong weakness signals in the sampled receipts.')
  }

  const suggestions: string[] = []
  if (topUnread.length > 0) {
    suggestions.push(
      '- Strengthen **Work style** / read-before-edit guidance for paths that repeatedly appear unread.'
    )
  }
  if (topFailures.length > 0) {
    suggestions.push(
      '- Add a short recovery hint for the top failure cluster (path checks, narrower retries).'
    )
  }
  if (victoryClaims > 0 || verifyNudges > 0) {
    suggestions.push(
      '- Reinforce verify-before-done / contract Done-when reminders in Agent mode section (not a hard gate).'
    )
  }
  if (suggestions.length === 0) {
    suggestions.push('- No harness edit suggested from this sample; keep the surface small.')
  }

  const markdown = [
    '# Harness proposal (auto-generated)',
    '',
    `Generated from ${receipts.length} receipt(s). Review only — does not apply automatically.`,
    '',
    '## Evidence',
    '',
    ...bullets.map((b) => `- ${b}`),
    '',
    '## Suggested harness edits',
    '',
    ...suggestions,
    '',
    '## Validation',
    '',
    '- `pnpm test -- tests/main/unit/harness.test.ts tests/main/unit/toolsSchema.test.ts tests/main/unit/modePolicy.test.ts tests/main/unit/loopPolicy.test.ts`',
    ''
  ].join('\n')

  return { receiptCount: receipts.length, bullets, markdown }
}

export function writeHarnessProposal(
  workspacePath: string,
  summary: WeaknessSummary
): { proposalPath: string; relativePath: string } {
  const dirRel = join('.vyotiq', 'harness', 'proposals')
  const dirAbs = resolveInsideWorkspace(workspacePath, dirRel)
  mkdirSync(dirAbs, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const shortId = randomBytes(3).toString('hex')
  const fileName = `${stamp}-${shortId}.md`
  const relativePath = `.vyotiq/harness/proposals/${fileName}`
  const proposalPath = resolveInsideWorkspace(workspacePath, relativePath)
  writeFileSync(proposalPath, summary.markdown, 'utf8')
  return { proposalPath, relativePath }
}

/** Mine receipts and write a workspace-visible proposal markdown. */
export function runHarnessReview(
  workspacePath: string,
  opts?: { limit?: number }
): HarnessReviewResult {
  const receipts = collectRecentReceipts(workspacePath, opts)
  const summary = summarizeWeaknesses(receipts)
  const written = writeHarnessProposal(workspacePath, summary)
  return {
    proposalPath: written.proposalPath,
    relativePath: written.relativePath,
    receiptCount: summary.receiptCount,
    summary: summary.bullets.join('\n')
  }
}
