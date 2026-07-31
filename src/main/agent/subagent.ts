/**
 * Sub-agent entry — registry ownership + depth gate, then shared nested loop
 * (`runNestedAgent`) that reuses main-agent harness / assembleContext / tools.
 */
import type { AgentEvent, AgentInteractionMode } from '../../shared/ipc'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { logger } from '../../shared/logger'
import { registerSubagent, unregisterSubagent } from './subagentRegistry'
import {
  allocateNestedAgentId,
  runNestedAgent,
  type SubagentOutcome,
  type SubagentUpdate
} from './nestedAgent'

export type { SubagentOutcome, SubagentUpdate }
export { NESTED_EXCLUDED_TOOLS, NESTED_ROLE_SECTION } from './nestedAgent'

/** @deprecated Nested agents use the full mode-filtered tool catalog minus exclusions. */
export const SUBAGENT_TOOLS = [
  'read',
  'search',
  'glob',
  'grep',
  'list_dir',
  'git_status',
  'git_diff',
  'diagnostics',
  'memory_read'
] as const

export type SubagentToolName = (typeof SUBAGENT_TOOLS)[number]

/** @deprecated Prefer mode-filtered catalog via runNestedAgent. */
export function subagentToolsForParentMode(
  parentMode: AgentInteractionMode = 'agent'
): readonly SubagentToolName[] {
  if (parentMode === 'ask') {
    return SUBAGENT_TOOLS.filter((name) => name !== 'diagnostics')
  }
  return SUBAGENT_TOOLS
}

/** A sub-agent may not spawn another one — callers must pass depth 0 (ceiling is exclusive). */
export const MAX_SUBAGENT_DEPTH = 1

/**
 * @deprecated Nested agents use loadHarness + assembleContext + NESTED_ROLE_SECTION.
 * Kept for unit tests that still assert the old builder shape during migration.
 */
export function buildSubagentSystem(
  workspaceRules: string,
  tools: readonly string[],
  sessionEnv?: string
): string {
  const list = tools.join(', ')
  const parts = [
    [
      'You are a nested agent working inside a larger coding agent.',
      '',
      'Finish with a single self-contained report.',
      `Available tools: ${list}.`
    ].join('\n')
  ]
  if (sessionEnv?.trim()) parts.push(sessionEnv.trim())
  const rules = workspaceRules.trim()
  if (rules) {
    const capped = rules.slice(0, 64 * 1024)
    parts.push(`${capped}${rules.length > capped.length ? '\n… (truncated)' : ''}`)
  }
  return parts.join('\n\n')
}

export type SubagentContextUsage = {
  step: number
  estimatedTokens: number
  contextWindow: number
  contentWindow: number
  model: string
}

export type SubagentOptions = {
  task: string
  context?: string
  workspace: string
  signal: AbortSignal
  /** Nesting level of the caller: 0 for the top-level run. */
  depth: number
  /** Parent Ask/Plan/Agent mode. */
  parentMode?: AgentInteractionMode
  /** Parent run directory; when set, the report is written under subagents/<id>/. */
  runDir?: string
  /** Parent run id — enables explicit registry dispose-for-invoke. */
  runId?: string
  /** Parent chat invoke id — scopes registry dispose. */
  invokeId?: number
  /** Parent tool-call id (for registry + UI routing). */
  parentToolCallId?: string
  emit?: (update: SubagentUpdate) => void
  /** Parent live-event sink — nested events are wrapped as `subagent_event`. */
  emitAgentEvent?: (event: AgentEvent) => void
  onContextUsage?: (usage: SubagentContextUsage) => void
}

/** Persist a sub-agent report under `{runDir}/subagents/<id>/` for post-compaction re-read. */
export function writeSubagentReportFiles(
  runDir: string,
  input: { ok: boolean; report: string; steps: number; task: string; id?: string }
): { reportRel: string; id: string } {
  const id = input.id ?? randomBytes(4).toString('hex')
  const dir = join(runDir, 'subagents', id)
  mkdirSync(dir, { recursive: true })
  const reportRel = `subagents/${id}/report.md`
  const reportBody = [
    `# Sub-agent report`,
    '',
    `ok: ${input.ok}`,
    `steps: ${input.steps}`,
    '',
    '## Task',
    '',
    input.task.trim() || '(empty)',
    '',
    '## Report',
    '',
    input.report.trim() || '(empty)',
    ''
  ].join('\n')
  writeFileSync(join(runDir, reportRel), reportBody, 'utf8')
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify(
      {
        id,
        ok: input.ok,
        steps: input.steps,
        reportRel,
        taskPreview: input.task.slice(0, 200),
        writtenAt: new Date().toISOString()
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
  return { reportRel, id }
}

export class SubagentDepthError extends Error {
  constructor() {
    super('Sub-agents cannot start other sub-agents. Do this work directly instead.')
    this.name = 'SubagentDepthError'
  }
}

/**
 * Run a nested agent (shared main-agent loop) and return its report.
 *
 * Each instance manages its own isolated context window; the parent only sees
 * the final report string (plus live `subagent_event` / progress mirrors).
 */
export async function runSubagent(options: SubagentOptions): Promise<SubagentOutcome> {
  if (options.depth >= MAX_SUBAGENT_DEPTH) throw new SubagentDepthError()

  let registryId: string | undefined
  let signal = options.signal
  if (typeof options.runId === 'string' && typeof options.invokeId === 'number') {
    const reg = registerSubagent({
      runId: options.runId,
      invokeId: options.invokeId,
      parentSignal: options.signal,
      parentToolCallId: options.parentToolCallId
    })
    registryId = reg.id
    signal = reg.signal
  }

  const subagentId = allocateNestedAgentId()

  try {
    return await runNestedAgent({
      task: options.task,
      context: options.context,
      workspace: options.workspace,
      signal,
      depth: options.depth,
      parentMode: options.parentMode,
      runDir: options.runDir,
      runId: options.runId,
      invokeId: options.invokeId,
      parentToolCallId: options.parentToolCallId,
      subagentId,
      emit: options.emit,
      onContextUsage: options.onContextUsage,
      emitNestedEvent: (ev) => {
        if (options.emitAgentEvent && options.runId && options.parentToolCallId) {
          options.emitAgentEvent({
            type: 'subagent_event',
            runId: options.runId,
            parentToolCallId: options.parentToolCallId,
            subagentId,
            event: ev
          })
        }
      }
    })
  } catch (err) {
    logger.warn('Nested agent failed', {
      scope: 'agent',
      code: 'SUBAGENT',
      err
    })
    throw err
  } finally {
    if (registryId) unregisterSubagent(registryId)
  }
}

/** @deprecated Prefer writeSubagentReportFiles — kept for call sites that only need a path check. */
export function nestedReportExists(runDir: string, id: string): boolean {
  return existsSync(join(runDir, 'subagents', id, 'report.md'))
}
