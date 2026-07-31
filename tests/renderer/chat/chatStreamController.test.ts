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
})
