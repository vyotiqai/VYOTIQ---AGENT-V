import { AgentEventSchema, type AgentEvent, type PersistedEvent } from '../ipc'

export { formatDisplayTime } from './timeFormat'

export type ActivityRow = { at: string; event: AgentEvent }

export function isAgentEvent(value: unknown): value is AgentEvent {
  return AgentEventSchema.safeParse(value).success
}

/** Non-transcript ops events (excludes stream noise). */
export function isActivityEvent(event: AgentEvent): boolean {
  return (
    event.type !== 'text_delta' &&
    event.type !== 'tool_call_delta' &&
    event.type !== 'assistant_message'
  )
}

/**
 * Activity panel rows: run telemetry only (no transcript tool rows or stream deltas).
 * Full tool output lives in messages.jsonl; tool_start/tool_result are excluded here.
 */
export function isActivityPanelEvent(event: AgentEvent): boolean {
  if (!isActivityEvent(event)) return false
  if (event.type === 'tool_start' || event.type === 'tool_result') return false
  if (event.type === 'thinking_delta' || event.type === 'thinking_done') return false
  return true
}

export function activityRowsFromEvents(
  events: PersistedEvent[]
): Array<{ at: string; event: AgentEvent }> {
  const out: Array<{ at: string; event: AgentEvent }> = []
  for (const row of events) {
    if (!isAgentEvent(row.event)) continue
    if (!isActivityEvent(row.event)) continue
    out.push({ at: row.at, event: row.event })
  }
  return out
}

export function activityPanelRowsFromEvents(events: PersistedEvent[]): ActivityRow[] {
  const out: ActivityRow[] = []
  for (const row of events) {
    if (!isAgentEvent(row.event)) continue
    if (!isActivityPanelEvent(row.event)) continue
    out.push({ at: row.at, event: row.event })
  }
  return out
}
