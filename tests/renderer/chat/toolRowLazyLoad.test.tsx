/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ToolRow } from '@renderer/features/chat/components/ToolRow'
import { TOOL_RESULT_IPC_PREVIEW_CHARS } from '@shared/utils/toolResultIpc'

describe('ToolRow lazy load', () => {
  it('fetches full content when expanding a truncated tool result', async () => {
    const preview = `${'x'.repeat(TOOL_RESULT_IPC_PREVIEW_CHARS)}\n…`
    const full = 'x'.repeat(TOOL_RESULT_IPC_PREVIEW_CHARS + 800)
    const load = vi.fn().mockResolvedValue(full)

    render(
      <ToolRow
        tool={{
          id: 'call-1',
          name: 'read',
          summary: 'big.ts',
          status: 'done',
          content: preview,
          contentTruncated: true
        }}
        onLoadFullContent={load}
      />
    )

    fireEvent.click(screen.getByLabelText('Show tool details'))

    await waitFor(() => {
      expect(load).toHaveBeenCalledWith('call-1')
    })
  })

  it('does not fetch when content is not truncated', () => {
    const load = vi.fn()

    render(
      <ToolRow
        tool={{
          id: 'call-2',
          name: 'read',
          summary: 'small.ts',
          status: 'done',
          content: 'hello'
        }}
        onLoadFullContent={load}
      />
    )

    fireEvent.click(screen.getByLabelText('Show tool details'))
    expect(load).not.toHaveBeenCalled()
  })
})
