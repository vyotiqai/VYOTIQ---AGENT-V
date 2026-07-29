import { describe, expect, it } from 'vitest'
import { executeTool } from '@main/agent/tools'
import { filterToolDefsForMode, isBuiltinAllowedInMode } from '@main/agent/tools/modePolicy'
import { AGENT_TOOLS } from '@main/agent/schemas/tools'
import { isApprovalExemptTool, isParallelSafeTool } from '@main/agent/tools/classify'

describe('switch_mode', () => {
  it('is allowed in every interaction mode', () => {
    expect(isBuiltinAllowedInMode('ask', 'switch_mode')).toBe(true)
    expect(isBuiltinAllowedInMode('plan', 'switch_mode')).toBe(true)
    expect(isBuiltinAllowedInMode('agent', 'switch_mode')).toBe(true)
  })

  it('is serial and approval-exempt', () => {
    expect(isParallelSafeTool('switch_mode')).toBe(false)
    expect(isApprovalExemptTool('switch_mode')).toBe(true)
    expect(isParallelSafeTool('ask_question')).toBe(false)
    expect(isApprovalExemptTool('ask_question')).toBe(true)
  })

  it('updates mutable mode and emits mode_changed', async () => {
    let mode: 'ask' | 'plan' | 'agent' = 'ask'
    const events: { type: string; mode?: string }[] = []
    const result = await executeTool(
      'switch_mode',
      JSON.stringify({ mode: 'agent' }),
      '/ws',
      new AbortController().signal,
      {
        runId: 'run-1',
        toolCallId: 'tc-1',
        getAgentMode: () => mode,
        setAgentMode: (next) => {
          mode = next
        },
        emitAgentEvent: (ev) => events.push(ev)
      }
    )
    expect(result.ok).toBe(true)
    expect(mode).toBe('agent')
    expect(events[0]?.type).toBe('mode_changed')
    expect(events[0]).toMatchObject({ type: 'mode_changed', runId: 'run-1', mode: 'agent' })
  })

  it('re-filters tool defs after mode change', () => {
    const askTools = filterToolDefsForMode('ask', AGENT_TOOLS).map((t) => t.name)
    expect(askTools).toContain('ask_question')
    expect(askTools).toContain('switch_mode')
    expect(askTools).not.toContain('edit')

    const agentTools = filterToolDefsForMode('agent', AGENT_TOOLS).map((t) => t.name)
    expect(agentTools).toContain('edit')
    expect(agentTools).toContain('ask_question')
  })
})
