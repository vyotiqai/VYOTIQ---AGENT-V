import { getToolHeaderMeta } from '../toolUi'
import { mapToolGroupProps } from './toolGroupAdapter'
import type { TranscriptRow } from './transcriptRows'

export type RunActivityPhase =
  | { kind: 'starting' }
  | { kind: 'thinking' }
  | { kind: 'writing' }
  | { kind: 'tool'; label: string; detail?: string }

const MAX_DETAIL_CHARS = 40

function truncateDetail(text: string | undefined): string | undefined {
  if (!text) return undefined
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= MAX_DETAIL_CHARS) return trimmed
  return `${trimmed.slice(0, MAX_DETAIL_CHARS - 1)}…`
}

function toolPhaseFromCard(row: Extract<TranscriptRow, { kind: 'card' }>): RunActivityPhase {
  const meta = getToolHeaderMeta(row.item.tool, {
    subagent: row.item.subagent,
    subagentContextUsage: row.item.subagentContextUsage
  })
  return {
    kind: 'tool',
    label: meta.verb,
    detail: truncateDetail(meta.target)
  }
}

function toolPhaseFromActivity(row: Extract<TranscriptRow, { kind: 'activity' }>): RunActivityPhase {
  const uiTools = row.tools.map((item) => item.tool)
  const props = mapToolGroupProps(uiTools, {})
  const runningTool = row.tools.find((item) => item.tool.status === 'running')
  let detail: string | undefined
  if (runningTool && props.singleTool) {
    const meta = getToolHeaderMeta(runningTool.tool, {
      subagent: runningTool.subagent,
      subagentContextUsage: runningTool.subagentContextUsage
    })
    detail = truncateDetail(meta.target)
  }
  return {
    kind: 'tool',
    label: props.runningLabel,
    detail
  }
}

export function formatRunActivityLabel(phase: RunActivityPhase): string {
  switch (phase.kind) {
    case 'starting':
      return 'Starting'
    case 'thinking':
      return 'Thinking'
    case 'writing':
      return 'Writing'
    case 'tool':
      return phase.detail ? `${phase.label} ${phase.detail}` : phase.label
    default: {
      const _exhaustive: never = phase
      return _exhaustive
    }
  }
}

/**
 * Derive what the agent is doing right now within an active turn.
 * Priority: thinking → prominent tool → compact tools → writing → starting.
 */
export function deriveRunActivity(
  turnRows: TranscriptRow[],
  pendingRun?: boolean
): RunActivityPhase {
  for (const row of turnRows) {
    if (row.kind === 'thinking' && row.item.thinkingStreaming === true) {
      return { kind: 'thinking' }
    }
  }

  for (let index = turnRows.length - 1; index >= 0; index -= 1) {
    const row = turnRows[index]!
    if (row.kind === 'card' && row.item.tool.status === 'running') {
      return toolPhaseFromCard(row)
    }
  }

  for (let index = turnRows.length - 1; index >= 0; index -= 1) {
    const row = turnRows[index]!
    if (row.kind === 'activity' && row.tools.some((item) => item.tool.status === 'running')) {
      return toolPhaseFromActivity(row)
    }
  }

  for (const row of turnRows) {
    if (row.kind === 'text' && row.item.streaming === true) {
      return { kind: 'writing' }
    }
  }

  if (pendingRun || turnRows.length === 0) {
    return { kind: 'starting' }
  }

  return { kind: 'starting' }
}
