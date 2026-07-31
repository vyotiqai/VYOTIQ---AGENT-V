import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '../storage/atomicWrite'
import type {
  ChatMessage,
  MessageContent,
  PersistedEvent,
  RunReceipt,
  RunReceiptSubagent,
  RunStatus
} from '../../shared/ipc'
import { contentToText, RUN_RECEIPT_VERSION, RunReceiptSchema } from '../../shared/ipc'
import {
  applyToolCallToKnownPaths,
  normalizeWorkspaceRelPath,
  toolArgsFromCall,
  unreadExistingEditPaths
} from './loopPolicy'
import { parseDiagnosticLines } from './tools/diagnostics'
import { logger } from '../../shared/logger'

export { RUN_RECEIPT_VERSION }
export const RUN_RECEIPT_FILENAME = 'receipt.json'
export type { RunReceipt }

type SeedToolMessage = {
  role: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  toolCallId?: string
  toolName?: string
  ok?: boolean
  content?: MessageContent
}

function toolStatsFromMessages(messages: readonly SeedToolMessage[]): RunReceipt['toolStats'] {
  const byName: Record<string, { ok: number; failed: number }> = {}
  let totalCalls = 0
  let ok = 0
  let failed = 0
  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.toolName) continue
    totalCalls++
    const entry = byName[msg.toolName] ?? { ok: 0, failed: 0 }
    if (msg.ok === false) {
      entry.failed++
      failed++
    } else {
      entry.ok++
      ok++
    }
    byName[msg.toolName] = entry
  }
  return { totalCalls, ok, failed, byName }
}

function failureClustersFromMessages(
  messages: readonly SeedToolMessage[],
  cap = 12
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>()
  for (const msg of messages) {
    if (msg.role !== 'tool' || msg.ok !== false || !msg.toolName) continue
    const text = contentToText(msg.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const key = `${msg.toolName}: ${text || '(no message)'}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, cap)
}

function unreadEditPathsFromMessages(messages: readonly SeedToolMessage[]): string[] {
  const known = new Set<string>()
  const unread = new Set<string>()
  const successfulCallIds = new Set(
    messages
      .filter((msg) => msg.role === 'tool' && msg.toolCallId && msg.ok !== false)
      .map((msg) => msg.toolCallId!)
  )
  // Transcript replay has no filesystem snapshot; treat edited paths as pre-existing.
  const pathExists = (): boolean => true
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.toolCalls) continue
    for (const call of msg.toolCalls) {
      const args = toolArgsFromCall(call.arguments)
      if (call.name === 'read' || call.name === 'grep' || call.name === 'glob') {
        applyToolCallToKnownPaths(known, call.name, args, successfulCallIds.has(call.id))
        continue
      }
      for (const path of unreadExistingEditPaths(known, call.name, args, pathExists)) {
        unread.add(path)
      }
      applyToolCallToKnownPaths(known, call.name, args, successfulCallIds.has(call.id))
    }
  }
  return [...unread].sort()
}

/** Paths from the latest writes_checkpoint event (object entries or legacy strings). */
export function wroteFilesFromEvents(events: readonly PersistedEvent[]): string[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]?.event as { type?: string; files?: unknown } | undefined
    if (ev?.type !== 'writes_checkpoint' || !Array.isArray(ev.files)) continue
    const paths: string[] = []
    for (const entry of ev.files) {
      if (typeof entry === 'string') {
        const path = normalizeWorkspaceRelPath(entry)
        if (path) paths.push(path)
        continue
      }
      if (entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string') {
        const path = normalizeWorkspaceRelPath((entry as { path: string }).path)
        if (path) paths.push(path)
      }
    }
    return paths
  }
  return []
}

function lastIncompleteFromEvents(
  events: readonly PersistedEvent[],
  invokeId?: number
): RunReceipt['incomplete'] | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]?.event as {
      type?: string
      invokeId?: number
      reason?: string
      message?: string
    } | undefined
    if (invokeId != null && ev?.invokeId !== invokeId) continue
    if (ev?.type !== 'incomplete' || typeof ev.reason !== 'string') continue
    const parsed = RunReceiptSchema.shape.incomplete.unwrap().safeParse({
      reason: ev.reason,
      ...(typeof ev.message === 'string' ? { message: ev.message } : {})
    })
    if (parsed.success) return parsed.data
  }
  return undefined
}

function tokenUsageFromEvents(
  events: readonly PersistedEvent[]
): RunReceipt['tokenUsage'] | undefined {
  let inputTokens = 0
  let outputTokens = 0
  let sawStep = false
  let lastContext: { inputTokens?: number } | undefined
  for (const row of events) {
    const ev = row.event as {
      type?: string
      inputTokens?: number
      outputTokens?: number
    } | undefined
    if (!ev?.type) continue
    if (ev.type === 'step_usage') {
      sawStep = true
      if (typeof ev.inputTokens === 'number') inputTokens += ev.inputTokens
      if (typeof ev.outputTokens === 'number') outputTokens += ev.outputTokens
    } else if (ev.type === 'context_usage') {
      lastContext = {
        ...(typeof ev.inputTokens === 'number' ? { inputTokens: ev.inputTokens } : {})
      }
    }
  }
  if (sawStep) {
    return {
      ...(inputTokens > 0 ? { inputTokens } : {}),
      ...(outputTokens > 0 ? { outputTokens } : {})
    }
  }
  if (lastContext && typeof lastContext.inputTokens === 'number') {
    return { inputTokens: lastContext.inputTokens }
  }
  return undefined
}

function compactionCountFromEvents(events: readonly PersistedEvent[]): number {
  let count = 0
  for (const row of events) {
    const ev = row.event as { type?: string } | undefined
    if (ev?.type === 'compaction') count++
  }
  return count
}

function contractExcerpt(contract: string, cap = 600): string {
  const text = contract.trim()
  if (!text) return ''
  const doneIdx = text.search(/^##\s*Done when\b/im)
  const slice = doneIdx >= 0 ? text.slice(doneIdx) : text
  return slice.length <= cap ? slice : slice.slice(0, cap) + '\n…'
}

/** Scan `{runDir}/subagents/<id>/` for a minimal receipt index (no report mining). */
export function scanSubagentsForReceipt(runDir: string): RunReceiptSubagent[] {
  const root = join(runDir, 'subagents')
  if (!existsSync(root)) return []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: RunReceiptSubagent[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    const statusPath = join(root, id, 'status.json')
    const defaultReportPath = `subagents/${id}/report.md`
    if (existsSync(statusPath)) {
      try {
        const raw = JSON.parse(readFileSync(statusPath, 'utf8')) as {
          ok?: unknown
          reportRel?: unknown
        }
        const reportPath =
          typeof raw.reportRel === 'string' && raw.reportRel.trim()
            ? raw.reportRel.replace(/\\/g, '/')
            : defaultReportPath
        out.push({
          id,
          status: raw.ok === true ? 'ok' : 'failed',
          reportPath
        })
        continue
      } catch {
        // fall through to report.md presence
      }
    }
    if (existsSync(join(root, id, 'report.md'))) {
      out.push({ id, status: 'ok', reportPath: defaultReportPath })
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function countDiagnosticsCalls(messages: readonly ChatMessage[]): {
  calls: number
  ok: number
  clean: number
} {
  let calls = 0
  let ok = 0
  let clean = 0
  for (const msg of messages) {
    if (msg.role !== 'tool' || msg.toolName !== 'diagnostics') continue
    calls++
    if (msg.ok !== false) {
      ok++
      const items = parseDiagnosticLines(contentToText(msg.content ?? ''))
      if (!items.some((d) => (d.severity ?? 'error') === 'error')) clean++
    }
  }
  return { calls, ok, clean }
}

export function buildRunReceipt(input: {
  runId: string
  status: RunStatus
  messages: readonly ChatMessage[]
  events: readonly PersistedEvent[]
  contract: string
  /** When set, scan for file-backed subagent reports. */
  runDir?: string
}): RunReceipt {
  const incomplete = lastIncompleteFromEvents(input.events, input.status.invokeId)
  const tokenUsage = tokenUsageFromEvents(input.events)
  const subagents = input.runDir ? scanSubagentsForReceipt(input.runDir) : []

  const receipt: RunReceipt = {
    version: RUN_RECEIPT_VERSION,
    writtenAt: new Date().toISOString(),
    runId: input.runId,
    status: input.status.status,
    step: input.status.step,
    ...(input.status.goal ? { goal: input.status.goal } : {}),
    ...(input.status.mode ? { mode: input.status.mode } : {}),
    ...(typeof input.status.consecutiveToolFailureSteps === 'number'
      ? { consecutiveToolFailureSteps: input.status.consecutiveToolFailureSteps }
      : {}),
    ...(input.status.error ? { statusError: input.status.error } : {}),
    ...(incomplete ? { incomplete } : {}),
    ...(tokenUsage ? { tokenUsage } : {}),
    compactionCount: compactionCountFromEvents(input.events),
    toolStats: toolStatsFromMessages(input.messages),
    failureClusters: failureClustersFromMessages(input.messages),
    unreadEditPaths: unreadEditPathsFromMessages(input.messages),
    wroteFiles: wroteFilesFromEvents(input.events),
    diagnostics: countDiagnosticsCalls(input.messages),
    contractExcerpt: contractExcerpt(input.contract),
    ...(subagents.length > 0 ? { subagents } : {})
  }
  return RunReceiptSchema.parse(receipt)
}

export function writeRunReceipt(runDir: string, receipt: RunReceipt): void {
  atomicWriteJson(join(runDir, RUN_RECEIPT_FILENAME), receipt)
}

/** Best-effort: load run state pieces and write receipt.json. Never throws to callers. */
export function writeRunReceiptBestEffort(input: {
  runDir: string
  runId: string
  loadStatus: (dir: string) => RunStatus | null
  loadMessages: () => ChatMessage[]
  loadEvents: (dir: string) => PersistedEvent[]
  readContract: (dir: string) => string
}): RunReceipt | null {
  try {
    const status = input.loadStatus(input.runDir)
    if (!status) return null
    const receipt = buildRunReceipt({
      runId: input.runId,
      status,
      messages: input.loadMessages(),
      events: input.loadEvents(input.runDir),
      contract: input.readContract(input.runDir),
      runDir: input.runDir
    })
    writeRunReceipt(input.runDir, receipt)
    return receipt
  } catch (err) {
    logger.warn('Failed to write run receipt', {
      scope: 'agent',
      correlationId: input.runId,
      err
    })
    return null
  }
}
