import { getToolHeaderMeta } from '../toolUi'
import { mapToolGroupProps } from './toolGroupAdapter'
import type { TranscriptRow } from './transcriptRows'

export type RunActivityPhase =
  | { kind: 'planning' }
  | { kind: 'working' }
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
  const runningTools = row.tools.filter((item) => item.tool.status === 'running')
  const allSubagents = row.tools.length > 0 && row.tools.every((item) => item.tool.name === 'subagent')

  if (allSubagents && row.tools.length > 1) {
    const count = runningTools.length > 0 ? runningTools.length : row.tools.length
    return {
      kind: 'tool',
      label: props.runningLabel,
      detail: `${count} agent${count === 1 ? '' : 's'}`
    }
  }

  const runningTool = runningTools[runningTools.length - 1]
  let detail: string | undefined
  if (runningTool && props.singleTool) {
    const meta = getToolHeaderMeta(runningTool.tool, {
      subagent: runningTool.subagent,
      subagentContextUsage: runningTool.subagentContextUsage
    })
    detail = truncateDetail(meta.target)
  } else if (runningTool && props.summary) {
    detail = truncateDetail(props.summary)
  }
  return {
    kind: 'tool',
    label: props.runningLabel,
    detail
  }
}

export function formatRunActivityLabel(phase: RunActivityPhase): string {
  switch (phase.kind) {
    case 'planning':
      return 'Planning'
    case 'working':
      return 'Working'
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

function lastActiveRow(
  turnRows: TranscriptRow[],
  matches: (row: TranscriptRow) => boolean
): TranscriptRow | undefined {
  for (let index = turnRows.length - 1; index >= 0; index -= 1) {
    const row = turnRows[index]!
    if (matches(row)) return row
  }
  return undefined
}

/**
 * Derive what the agent is doing right now within an active turn.
 * Priority: prominent tool → compact tools → thinking → writing → planning/working.
 * Within each tier, prefer the latest row so live work beats earlier steps.
 */
export function deriveRunActivity(
  turnRows: TranscriptRow[],
  pendingRun?: boolean
): RunActivityPhase {
  const runningCard = lastActiveRow(
    turnRows,
    (row) => row.kind === 'card' && row.item.tool.status === 'running'
  )
  if (runningCard?.kind === 'card') return toolPhaseFromCard(runningCard)

  const runningActivity = lastActiveRow(
    turnRows,
    (row) => row.kind === 'activity' && row.tools.some((item) => item.tool.status === 'running')
  )
  if (runningActivity?.kind === 'activity') return toolPhaseFromActivity(runningActivity)

  const streamingThinking = lastActiveRow(
    turnRows,
    (row) => row.kind === 'thinking' && row.item.thinkingStreaming === true
  )
  if (streamingThinking) return { kind: 'thinking' }

  const streamingText = lastActiveRow(
    turnRows,
    (row) => row.kind === 'text' && row.item.streaming === true
  )
  if (streamingText) return { kind: 'writing' }

  if (pendingRun) {
    return { kind: 'planning' }
  }

  return { kind: 'working' }
}
