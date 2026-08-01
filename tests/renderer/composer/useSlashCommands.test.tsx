/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSlashCommands } from '@renderer/features/chat/components/composer/useSlashCommands'

const commands = [
  {
    id: 'builtin:a',
    trigger: 'alpha',
    label: 'Alpha',
    description: 'A',
    kind: 'builtin' as const,
    group: 'App',
    availability: 'ready' as const
  },
  {
    id: 'builtin:b',
    trigger: 'beta',
    label: 'Beta',
    description: 'B',
    kind: 'builtin' as const,
    group: 'App',
    availability: 'ready' as const
  }
]

beforeEach(() => {
  Object.defineProperty(window, 'vyotiq', {
    configurable: true,
    writable: true,
    value: {
      slashCommandsList: vi.fn().mockResolvedValue({ ok: true, data: { commands } })
    }
  })
})

describe('useSlashCommands navigation', () => {
  it('clamps arrow navigation at the ends', async () => {
    const { result } = renderHook(() =>
      useSlashCommands({
        text: '/',
        cursor: 1,
        enabled: true
      })
    )

    await act(async () => {
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(result.current.filtered.length).toBe(2))

    act(() => result.current.moveActive(-1))
    expect(result.current.activeIndex).toBe(0)

    act(() => result.current.moveActive(1))
    expect(result.current.activeIndex).toBe(1)

    act(() => result.current.moveActive(1))
    expect(result.current.activeIndex).toBe(1)
  })

  it('stays open with a token even when nothing matches', async () => {
    const { result } = renderHook(() =>
      useSlashCommands({
        text: '/zzzz',
        cursor: 5,
        enabled: true
      })
    )

    await act(async () => {
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(result.current.open).toBe(true))
    expect(result.current.filtered).toEqual([])
  })
})
