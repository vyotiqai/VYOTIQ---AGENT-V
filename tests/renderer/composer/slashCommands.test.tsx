/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Composer } from '@renderer/features/chat/components/composer/Composer'

const slashCommands = [
  {
    id: 'builtin:compact',
    trigger: 'compact',
    label: 'Compact context',
    description: 'Summarize older messages',
    kind: 'builtin' as const,
    group: 'App',
    availability: 'ready' as const
  },
  {
    id: 'skill:code-review',
    trigger: 'code-review',
    label: 'code-review',
    description: 'Review diffs',
    kind: 'skill' as const,
    group: 'Skills',
    availability: 'ready' as const,
    packageId: 'code-review'
  }
]

beforeEach(() => {
  Object.defineProperty(window, 'vyotiq', {
    configurable: true,
    writable: true,
    value: {
      slashCommandsList: vi.fn().mockResolvedValue({ ok: true, data: { commands: slashCommands } }),
      slashCommandsResolve: vi.fn().mockImplementation(async (payload: { id: string }) => {
        if (payload.id === 'builtin:compact') {
          return { ok: true, data: { action: 'client', clientAction: 'compact' } }
        }
        if (payload.id === 'skill:code-review') {
          return {
            ok: true,
            data: {
              action: 'send',
              message: '[Skill: code-review]\n\n<body>'
            }
          }
        }
        return { ok: false, error: 'unknown' }
      }),
      listModels: vi.fn().mockResolvedValue({ ok: true, data: { models: [] } })
    }
  })
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const baseProps = {
  provider: 'ollama' as const,
  model: 'qwen2.5',
  running: false,
  hasWorkspace: true,
  workspacePath: null as string | null,
  draft: '',
  onDraftChange: vi.fn(),
  onProviderModel: vi.fn(),
  chatSettings: {
    provider: 'ollama' as const,
    model: 'qwen2.5',
    compactionTriggerRatio: 0.7,
    keepRecentTurns: 12,
    memoryAutoPromote: true,
    thinkingEnabled: true,
    thinkingEffort: 'medium' as const,
    showThinking: true
  },
  onChatSettingsChange: vi.fn(),
  onSend: vi.fn().mockResolvedValue(true),
  onStop: vi.fn(),
  variant: 'hero' as const
}

describe('Composer slash commands', () => {
  it('does not fetch slash commands until the user types /', async () => {
    render(<Composer {...baseProps} />)
    expect(window.vyotiq.slashCommandsList).not.toHaveBeenCalled()
  })

  it('opens the slash menu when typing / and filters by query', async () => {
    const onDraftChange = vi.fn()
    const { rerender } = render(<Composer {...baseProps} draft="" onDraftChange={onDraftChange} />)

    const ta = screen.getByRole('textbox', { name: /^Message$/i })
    ta.textContent = '/com'
    fireEvent.input(ta)
    expect(onDraftChange).toHaveBeenCalledWith('/com')

    rerender(<Composer {...baseProps} draft="/com" onDraftChange={onDraftChange} />)
    fireEvent.focus(ta)

    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: /Slash commands/i })).toBeTruthy()
    })
    expect(screen.getByText('/compact')).toBeTruthy()
  })

  it('renders hero composer with message field', () => {
    render(<Composer {...baseProps} />)
    expect(screen.getByRole('textbox', { name: /^Message$/i })).toBeTruthy()
  })

  it('resolves /compact as a client action without sending chat', async () => {
    const onCompact = vi.fn()
    const onSend = vi.fn()
    const onDraftChange = vi.fn()
    const { rerender } = render(
      <Composer
        {...baseProps}
        draft="/compact"
        onDraftChange={onDraftChange}
        onSend={onSend}
        slashHandlers={{ onCompact }}
      />
    )

    await waitFor(() => expect(window.vyotiq.slashCommandsList).toHaveBeenCalled())

    rerender(
      <Composer
        {...baseProps}
        draft="/compact"
        onDraftChange={onDraftChange}
        onSend={onSend}
        slashHandlers={{ onCompact }}
      />
    )

    const form = screen.getByRole('textbox', { name: /^Message$/i }).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(window.vyotiq.slashCommandsResolve).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'builtin:compact' })
      )
    })
    await waitFor(() => expect(onCompact).toHaveBeenCalled())
    expect(onSend).not.toHaveBeenCalled()
  })
})
