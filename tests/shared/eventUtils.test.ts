import { describe, expect, it } from 'vitest'
import { isAgentEvent, activityRowsFromEvents, activityPanelRowsFromEvents, isActivityEvent, formatDisplayTime } from '@shared/eventUtils'

describe('isAgentEvent', () => {
  it('accepts valid agent events', () => {
    expect(
      isAgentEvent({
        type: 'tool_start',
        runId: 'r1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts'
      })
    ).toBe(true)
  })

  it('rejects objects with only a type field', () => {
    expect(isAgentEvent({ type: 'status' })).toBe(false)
    expect(isAgentEvent({ type: 'tool_start' })).toBe(false)
    expect(isAgentEvent(null)).toBe(false)
    expect(isAgentEvent('text_delta')).toBe(false)
  })
})

describe('formatDisplayTime', () => {
  it('formats a valid ISO timestamp', () => {
    const label = formatDisplayTime('2026-07-24T15:30:45.000Z')
    expect(label.length).toBeGreaterThan(0)
    expect(label).not.toBe('2026-07-24T15:30:45.000Z')
  })

  it('includes seconds when requested', () => {
    const withSeconds = formatDisplayTime('2026-07-24T15:30:45.000Z', { seconds: true })
    const withoutSeconds = formatDisplayTime('2026-07-24T15:30:45.000Z')
    expect(withSeconds.length).toBeGreaterThanOrEqual(withoutSeconds.length)
  })

  it('returns empty string for invalid timestamps', () => {
    expect(formatDisplayTime('not-a-date')).toBe('')
    expect(formatDisplayTime('')).toBe('')
  })
})

describe('isActivityEvent', () => {
  it('excludes transcript stream events', () => {
    expect(isActivityEvent({ type: 'text_delta', runId: 'r1', text: 'hi' })).toBe(false)
    expect(isActivityEvent({ type: 'tool_call_delta', runId: 'r1', toolCallId: 'c1', name: 'read', argumentsDelta: '{}' })).toBe(false)
    expect(isActivityEvent({ type: 'assistant_message', runId: 'r1', content: 'hi' })).toBe(false)
  })

  it('includes operational events', () => {
    expect(
      isActivityEvent({
        type: 'tool_start',
        runId: 'r1',
        toolCallId: 'c1',
        name: 'read',
        summary: 'a.ts'
      })
    ).toBe(true)
    expect(isActivityEvent({ type: 'status', runId: 'r1', status: 'running' })).toBe(true)
  })
})

describe('activityPanelRowsFromEvents', () => {
  it('includes run telemetry but excludes transcript tool rows', () => {
    const rows = activityPanelRowsFromEvents([
      {
        at: '2026-07-24T12:00:00.000Z',
        event: { type: 'status', runId: 'r1', status: 'running' }
      },
      {
        at: '2026-07-24T12:00:01.000Z',
        event: {
          type: 'tool_start',
          runId: 'r1',
          toolCallId: 'c1',
          name: 'read',
          summary: 'a.ts'
        }
      },
      {
        at: '2026-07-24T12:00:02.000Z',
        event: {
          type: 'step_usage',
          runId: 'r1',
          step: 1,
          inputTokens: 100,
          outputTokens: 20
        }
      }
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.event.type)).toEqual(['status', 'step_usage'])
  })
})
