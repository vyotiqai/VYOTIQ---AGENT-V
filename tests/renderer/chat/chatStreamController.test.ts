/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { createChatStreamController } from '@renderer/lib/hooks/createChatStreamController'

describe('createChatStreamController', () => {
  it('persists turn collapse across transcript remounts', () => {
    const controller = createChatStreamController({ workspacePath: '/ws' })

    expect(controller.collapsedTurnIndices).toEqual([])

    controller.toggleTurnCollapsed(0)
    expect(controller.collapsedTurnIndices).toEqual([0])

    controller.toggleTurnCollapsed(0)
    expect(controller.collapsedTurnIndices).toEqual([])

    controller.toggleTurnCollapsed(1)
    controller.toggleTurnCollapsed(2)
    expect(controller.collapsedTurnIndices).toEqual([1, 2])

    controller.reset()
    expect(controller.collapsedTurnIndices).toEqual([])
  })

  it('appends terminal_output_delta into a running terminal tool row', () => {
    const controller = createChatStreamController({ workspacePath: '/ws', runId: 'r1' })

    controller.handleEvent({
      type: 'tool_start',
      runId: 'r1',
      toolCallId: 'term-1',
      name: 'terminal',
      summary: 'echo hi'
    })
    controller.handleEvent({
      type: 'terminal_output_delta',
      runId: 'r1',
      toolCallId: 'term-1',
      text: 'hi\n',
      stream: 'stdout'
    })
    controller.handleEvent({
      type: 'terminal_output_delta',
      runId: 'r1',
      toolCallId: 'term-1',
      text: 'boom\n',
      stream: 'stderr'
    })

    const tool = controller.items.find((item) => item.kind === 'tool' && item.id === 'term-1')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind !== 'tool') return
    expect(tool.tool.status).toBe('running')
    expect(tool.tool.content).toBe('hi\n\nstderr:\nboom\n')
  })

  it('keeps UI suspended until disk catch-up finishes so live deltas are not clobbered', async () => {
    const diskPayload = {
      ok: true as const,
      data: {
        runId: 'r1',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'from-disk' }
        ]
      }
    }
    const loadRunEvents = vi.fn().mockResolvedValue({ ok: true, data: [] })
    const listActiveRuns = vi.fn().mockResolvedValue({
      ok: true,
      data: [{ runId: 'r1', invokeId: 1, workspacePath: '/ws' }]
    })
    let controller!: ReturnType<typeof createChatStreamController>
    const loadRun = vi.fn(async () => {
      // Catch-up must still be suspended so in-flight live deltas are dropped,
      // not applied and then wiped by hydrateFromDisk.
      expect(controller.uiSuspended).toBe(true)
      controller.handleEvent({ type: 'text_delta', runId: 'r1', text: ' during', invokeId: 1 })
      expect(
        controller.items.some((i) => i.kind === 'message' && String(i.content).includes('during'))
      ).toBe(false)
      return diskPayload
    })

    // @ts-expect-error test bridge
    window.vyotiq = {
      loadRun,
      loadRunEvents,
      listActiveRuns
    }

    controller = createChatStreamController({ workspacePath: '/ws', runId: 'r1' })
    controller.handleEvent({ type: 'status', runId: 'r1', status: 'running', invokeId: 1 })
    controller.handleEvent({ type: 'text_delta', runId: 'r1', text: 'before', invokeId: 1 })

    controller.setUiSuspended(true)
    controller.handleEvent({ type: 'text_delta', runId: 'r1', text: ' skipped', invokeId: 1 })
    expect(controller.items.some((i) => i.kind === 'message' && i.content === 'before skipped')).toBe(
      false
    )

    await controller.resumeUiIfNeeded()

    expect(controller.uiSuspended).toBe(false)
    expect(loadRun).toHaveBeenCalledWith('/ws', 'r1')
    expect(controller.items.some((i) => i.kind === 'message' && i.content === 'from-disk')).toBe(true)
    expect(
      controller.items.some((i) => i.kind === 'message' && String(i.content).includes('during'))
    ).toBe(false)
  })

  it('folds subagent_event envelopes into the parent nestedAgent panel', () => {
    const controller = createChatStreamController({ workspacePath: '/ws', runId: 'r1' })

    controller.handleEvent({
      type: 'tool_start',
      runId: 'r1',
      toolCallId: 'parent-1',
      name: 'subagent',
      summary: 'Investigate auth'
    })
    controller.handleEvent({
      type: 'subagent_event',
      runId: 'r1',
      parentToolCallId: 'parent-1',
      subagentId: 'ab12',
      event: { type: 'text_delta', runId: 'nested', text: 'Looking at auth…' }
    })
    controller.handleEvent({
      type: 'subagent_event',
      runId: 'r1',
      parentToolCallId: 'parent-1',
      subagentId: 'ab12',
      event: {
        type: 'tool_start',
        runId: 'nested',
        toolCallId: 'n-read',
        name: 'read',
        summary: 'src/auth.ts'
      }
    })

    const tool = controller.items.find((item) => item.kind === 'tool' && item.id === 'parent-1')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind !== 'tool') return
    expect(tool.nestedAgent?.subagentId).toBe('ab12')
    expect(
      tool.nestedAgent?.leaves.some((l) => l.kind === 'text' && l.text.includes('Looking at auth'))
    ).toBe(true)
    expect(tool.nestedAgent?.leaves.some((l) => l.kind === 'tool' && l.id === 'n-read')).toBe(true)
  })

  it('attaches nested approval requests under the parent subagent panel', () => {
    const controller = createChatStreamController({ workspacePath: '/ws', runId: 'r1' })

    controller.handleEvent({
      type: 'tool_start',
      runId: 'r1',
      toolCallId: 'parent-1',
      name: 'subagent',
      summary: 'Edit config'
    })
    controller.handleEvent({
      type: 'subagent_event',
      runId: 'r1',
      parentToolCallId: 'parent-1',
      subagentId: 'cd34',
      event: {
        type: 'tool_start',
        runId: 'nested',
        toolCallId: 'n-edit',
        name: 'edit',
        summary: 'config.json'
      }
    })
    controller.handleApprovalRequest({
      requestId: 'apr-1',
      runId: 'r1',
      toolCallId: 'n-edit',
      name: 'edit',
      summary: 'config.json',
      argsPreview: '{"path":"config.json"}',
      mutating: true,
      parentToolCallId: 'parent-1',
      subagentId: 'cd34'
    })

    const tool = controller.items.find((item) => item.kind === 'tool' && item.id === 'parent-1')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind !== 'tool') return
    const leaf = tool.nestedAgent?.leaves.find((l) => l.kind === 'tool' && l.id === 'n-edit')
    expect(leaf?.kind).toBe('tool')
    if (leaf?.kind !== 'tool') return
    expect(leaf.approval?.requestId).toBe('apr-1')
    expect(leaf.approval?.toolName).toBe('edit')
  })

  it('editAndResend truncates transcript and calls chatRewindAndStart', async () => {
    const chatRewindAndStart = vi.fn().mockResolvedValue({
      ok: true,
      data: { runId: 'r1', invokeId: 2 }
    })
    const chatCancel = vi.fn().mockResolvedValue({ ok: true, data: true })
    // @ts-expect-error test bridge
    window.vyotiq = { chatRewindAndStart, chatCancel }

    const controller = createChatStreamController({ workspacePath: '/ws', runId: 'r1' })
    controller.hydrateTranscript([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply-1' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'reply-2' }
    ])

    const ok = await controller.editAndResend(0, 'first edited')
    expect(ok).toBe(true)
    expect(chatRewindAndStart).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '/ws',
        runId: 'r1',
        editMessageIndex: 0,
        editedUserMessage: { role: 'user', content: 'first edited' }
      })
    )
    expect(controller.messages).toEqual([{ role: 'user', content: 'first edited' }])
    expect(controller.messages.some((m) => m.content === 'reply-2')).toBe(false)
    expect(controller.running).toBe(true)
  })

  it('editAndResend rolls back UI when chatRewindAndStart fails', async () => {
    const chatRewindAndStart = vi.fn().mockResolvedValue({
      ok: false,
      error: 'rewind failed'
    })
    const chatCancel = vi.fn().mockResolvedValue({ ok: true, data: true })
    // @ts-expect-error test bridge
    window.vyotiq = { chatRewindAndStart, chatCancel }

    const controller = createChatStreamController({ workspacePath: '/ws', runId: 'r1' })
    const prior = [
      { role: 'user' as const, content: 'keep me' },
      { role: 'assistant' as const, content: 'stay' },
      { role: 'user' as const, content: 'edit me' },
      { role: 'assistant' as const, content: 'drop on success' }
    ]
    controller.hydrateTranscript(prior)

    const ok = await controller.editAndResend(2, 'edited')
    expect(ok).toBe(false)
    expect(controller.messages).toEqual(prior)
    expect(controller.error).toBe('rewind failed')
    expect(controller.running).toBe(false)
  })
})
