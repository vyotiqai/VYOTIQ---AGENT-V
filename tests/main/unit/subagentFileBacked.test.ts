import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ChatMessage } from '@shared/ipc'
import { writeSubagentReportFiles } from '@main/agent/subagent'
import { trimToolResults } from '@main/agent/context/toolTrim'
import { buildRunReceipt, RUN_RECEIPT_FILENAME, scanSubagentsForReceipt } from '@main/agent/runReceipt'
import { executeTool } from '@main/agent/tools'
import { loadSubagentReports, collectRecentReceipts } from '@main/agent/harnessReview'
import { workspaceSessionsRoot } from '@main/storage/paths'

const userData = join(tmpdir(), `vyotiq-subagent-fb-${process.pid}-${Date.now()}`)

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

describe('subagent file-backed audit pipeline', () => {
  let workspace: string
  let runDir: string

  beforeEach(() => {
    workspace = join(userData, `ws-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    runDir = join(workspaceSessionsRoot(workspace), 'run-fb')
    mkdirSync(runDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(userData)) {
      rmSync(userData, { recursive: true, force: true })
    }
  })

  it('persist → stub → read remap → receipt index → harness load', async () => {
    const { reportRel, id } = writeSubagentReportFiles(runDir, {
      ok: true,
      report: 'Auth lives in src/auth.ts:12.',
      steps: 3,
      task: 'Find auth entrypoint'
    })
    expect(reportRel).toBe(`subagents/${id}/report.md`)
    expect(existsSync(join(runDir, reportRel))).toBe(true)

    const fullToolBody =
      `Persisted report: ${reportRel} (re-read with \`read\` after compaction).\n\n` +
      'Auth lives in src/auth.ts:12.\n' +
      'x'.repeat(12_000)

    const msgs: ChatMessage[] = [
      { role: 'user', content: 'investigate auth' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'sa1', name: 'subagent', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'sa1', toolName: 'subagent', content: fullToolBody },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'r1', name: 'read', arguments: '{}' }]
      },
      { role: 'tool', toolCallId: 'r1', toolName: 'read', content: 'later' }
    ]

    const trimmed = trimToolResults(msgs, 1, { trimSubagent: true })
    const stubbed = trimmed.find((m) => m.role === 'tool' && m.toolName === 'subagent')
    const stubText = String(stubbed?.content ?? '')
    expect(stubText).toContain(`Persisted report: ${reportRel}`)
    expect(stubText).toContain('[cleared: re-read with tools]')
    expect(stubText).not.toContain('x'.repeat(100))

    const pathMatch = stubText.match(/Persisted report:\s+(\S+)\s+\(re-read with/)
    expect(pathMatch?.[1]).toBe(reportRel)

    const readResult = await executeTool(
      'read',
      JSON.stringify({ path: reportRel }),
      workspace,
      new AbortController().signal,
      { runDir, agentMode: 'agent' }
    )
    expect(readResult.ok).toBe(true)
    expect(readResult.content).toMatch(/Auth lives in src\/auth\.ts:12/)
    expect(readResult.content).toMatch(/## Task/)

    const indexed = scanSubagentsForReceipt(runDir)
    expect(indexed).toEqual([{ id, status: 'ok', reportPath: reportRel }])

    const receipt = buildRunReceipt({
      runId: 'run-fb',
      status: { status: 'done', step: 2, updatedAt: new Date().toISOString() },
      messages: trimmed,
      events: [],
      contract: '',
      verifyMode: 'off',
      verifyNudged: false,
      runDir
    })
    expect(receipt.subagents).toEqual([{ id, status: 'ok', reportPath: reportRel }])
    writeFileSync(join(runDir, RUN_RECEIPT_FILENAME), JSON.stringify(receipt), 'utf8')

    const collected = collectRecentReceipts(workspace)
    const reports = loadSubagentReports(workspace, collected)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.id).toBe(id)
    expect(reports[0]?.ok).toBe(true)
    expect(reports[0]?.report).toMatch(/Auth lives in src\/auth\.ts:12/)
    expect(readFileSync(join(runDir, reportRel), 'utf8')).toMatch(/Find auth entrypoint/)
  })
})
