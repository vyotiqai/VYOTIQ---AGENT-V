import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { AgentEvent } from '@shared/ipc'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

const mockWin = vi.hoisted(() => ({
  isDestroyed: vi.fn(() => false),
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  isMaximized: vi.fn(() => false),
  close: vi.fn()
}))

const mockWcSend = vi.hoisted(() => vi.fn())
const mockWc = vi.hoisted(() => ({
  isDestroyed: vi.fn(() => false),
  send: mockWcSend
}))

const clearRunAbortMock = vi.hoisted(() => vi.fn())
const markRunTurnCompleteMock = vi.hoisted(() => vi.fn())
const registerRunAbortMock = vi.hoisted(() =>
  vi.fn(() => ({ controller: new AbortController(), invokeId: 42 }))
)
const tryRegisterRunAbortMock = vi.hoisted(() =>
  vi.fn(() => ({ ok: true as const, controller: new AbortController(), invokeId: 42 }))
)
const isRunTurnCompleteMock = vi.hoisted(() => vi.fn(() => false))
const waitUntilRunInactiveMock = vi.hoisted(() => vi.fn(async () => true))
const runAgentMock = vi.hoisted(() => vi.fn())
const runExistsMock = vi.hoisted(() => vi.fn())
const isActiveMock = vi.hoisted(() => vi.fn(() => false))
const prepareRewindMock = vi.hoisted(() =>
  vi.fn(async () => ({
    messages: [{ role: 'user' as const, content: 'edited' }],
    writes: { restored: [] as string[], checkpointIds: [] as string[] }
  }))
)
const fromWebContents = vi.hoisted(() => vi.fn(() => mockWin))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  },
  BrowserWindow: {
    fromWebContents
  },
  nativeTheme: {
    shouldUseDarkColors: true
  },
  shell: {
    openPath: vi.fn(async () => '')
  }
}))

vi.mock('@main/workspace/workspace', () => ({
  pickWorkspace: vi.fn()
}))

vi.mock('@main/settings/settings', () => ({
  getSettings: () => ({
    provider: 'ollama',
    model: 'qwen2.5',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    theme: 'system',
    telemetryEnabled: false
  }),
  setSettings: vi.fn()
}))

vi.mock('@main/settings/secrets', () => ({
  setSecret: vi.fn(),
  clearSecret: vi.fn(),
  getSecret: vi.fn(),
  secretStatus: vi.fn(() => ({}))
}))

vi.mock('@main/agent/loop', () => ({
  runAgent: runAgentMock,
  createRunId: () => 'run-test',
  registerRunAbort: vi.fn()
}))

vi.mock('@main/agent/rewindRun', () => ({
  prepareRewindAndReplaceUserMessage: prepareRewindMock
}))

vi.mock('@main/agent/providers', () => ({
  listProviderModels: vi.fn()
}))

vi.mock('@main/agent/providers/modelCache', () => ({
  clearModelCache: vi.fn()
}))

vi.mock('@main/agent/runRegistry', () => ({
  chatCancelResult: vi.fn(),
  listActiveRuns: vi.fn(() => []),
  registerRunAbort: registerRunAbortMock,
  tryRegisterRunAbort: tryRegisterRunAbortMock,
  clearRunAbort: clearRunAbortMock,
  markRunTurnComplete: markRunTurnCompleteMock,
  isActive: isActiveMock,
  isRunTurnComplete: isRunTurnCompleteMock,
  waitUntilRunInactive: waitUntilRunInactiveMock,
  enqueueFollowUp: vi.fn(),
  removeFollowUp: vi.fn(),
  getRunInvokeId: vi.fn(() => 1),
  followUpPreview: vi.fn(() => 'preview'),
  getRunWorkspace: vi.fn(() => '/ws')
}))

vi.mock('@main/agent/state', () => ({
  listRuns: vi.fn(),
  loadMessages: vi.fn(),
  loadMessagesAsync: vi.fn(),
  loadEventsForRun: vi.fn(),
  loadEventsForRunAsync: vi.fn(),
  LOAD_EVENTS_UI_LIMIT: 500,
  loadToolResultContent: vi.fn(),
  deleteRun: vi.fn(),
  renameRun: vi.fn(),
  runExists: runExistsMock
}))

vi.mock('@main/workspace/workspaces', () => ({
  getWorkspaces: vi.fn(() => ({
    version: 2,
    workspaceIdsByPath: {},
    legacySessionsMigrated: true,
    openPaths: ['/ws'],
    activePath: '/ws',
    recentPaths: [],
    uiStateByPath: {},
    settingsOverridesByPath: {}
  })),
  addWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  setActiveWorkspace: vi.fn(),
  updateWorkspaceUiState: vi.fn(),
  setWorkspaceSettingsOverride: vi.fn()
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: (path: import('fs').PathLike) => {
      if (String(path) === '/ws') return true
      return actual.existsSync(path)
    }
  }
})

vi.mock('@main/app/window', () => ({
  applyTitleBarTheme: vi.fn(),
  getMainWindow: () => null
}))

vi.mock('@main/logging/init', () => ({
  logsDirectory: () => '/tmp/logs'
}))

vi.mock('@main/logging/sentry', () => ({
  applySentryTelemetry: vi.fn(),
  isSentryBuildConfigured: () => false
}))

import { registerIpc } from '@main/ipc/register'

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function chatEvents(): AgentEvent[] {
  return mockWcSend.mock.calls.map(([, ev]) => ev as AgentEvent)
}

describe('registerIpc', () => {
  beforeEach(() => {
    handlers.clear()
    mockWcSend.mockReset()
    mockWc.isDestroyed.mockReturnValue(false)
    fromWebContents.mockReturnValue(mockWin)
    runAgentMock.mockReset()
    runExistsMock.mockReset()
    isActiveMock.mockReset()
    clearRunAbortMock.mockReset()
    markRunTurnCompleteMock.mockReset()
    registerRunAbortMock.mockReset()
    registerRunAbortMock.mockReturnValue({ controller: new AbortController(), invokeId: 42 })
    tryRegisterRunAbortMock.mockReset()
    tryRegisterRunAbortMock.mockReturnValue({
      ok: true as const,
      controller: new AbortController(),
      invokeId: 42
    })
    isRunTurnCompleteMock.mockReset()
    isRunTurnCompleteMock.mockReturnValue(false)
    waitUntilRunInactiveMock.mockReset()
    waitUntilRunInactiveMock.mockResolvedValue(true)
    isActiveMock.mockReturnValue(false)
    prepareRewindMock.mockReset()
    prepareRewindMock.mockResolvedValue({
      messages: [{ role: 'user' as const, content: 'edited' }],
      writes: { restored: [], checkpointIds: [] }
    })
    registerIpc()
  })

  afterEach(() => {
    handlers.clear()
  })

  describe('getSystemTheme', () => {
    it('rejects invalid senders', async () => {
      fromWebContents.mockReturnValueOnce(null)
      const handler = handlers.get(IPC.getSystemTheme)
      expect(handler).toBeTypeOf('function')

      const result = await handler!({ sender: {} })
      expect(result).toEqual({ ok: false, error: 'Invalid sender' })
    })

    it('returns native theme for valid senders', async () => {
      const handler = handlers.get(IPC.getSystemTheme)
      const result = await handler!({ sender: mockWc })
      expect(result).toEqual({ ok: true, data: true })
    })
  })

  describe('chatStart defensive catch', () => {
    const chatStartPayload = {
      messages: [{ role: 'user' as const, content: 'hello' }],
      workspacePath: '/ws'
    }

    it('does not duplicate cancelled status when generator throws after terminal status', async () => {
      runAgentMock.mockImplementation(async function* () {
        yield { type: 'status', runId: 'run-test', status: 'cancelled' } satisfies AgentEvent
        throw new DOMException('Aborted', 'AbortError')
      })

      const handler = handlers.get(IPC.chatStart)
      await handler!({ sender: mockWc }, chatStartPayload)
      await flushAsync()

      const cancelled = chatEvents().filter(
        (ev) => ev.type === 'status' && ev.status === 'cancelled'
      )
      expect(cancelled).toHaveLength(1)
    })

    it('does not duplicate error terminal events when generator throws after status error', async () => {
      runAgentMock.mockImplementation(async function* () {
        yield { type: 'status', runId: 'run-test', status: 'error' } satisfies AgentEvent
        throw new Error('post-terminal throw')
      })

      const handler = handlers.get(IPC.chatStart)
      await handler!({ sender: mockWc }, chatStartPayload)
      await flushAsync()

      const statusErrors = chatEvents().filter(
        (ev) => ev.type === 'status' && ev.status === 'error'
      )
      const errors = chatEvents().filter((ev) => ev.type === 'error')
      expect(statusErrors).toHaveLength(1)
      expect(errors).toHaveLength(0)
    })

    it('still emits error terminal events when generator throws before terminal status', async () => {
      runAgentMock.mockImplementation(async function* () {
        yield { type: 'text_delta', runId: 'run-test', text: 'partial' } satisfies AgentEvent
        throw new Error('boom')
      })

      const handler = handlers.get(IPC.chatStart)
      await handler!({ sender: mockWc }, chatStartPayload)
      await flushAsync()

      const statusErrors = chatEvents().filter(
        (ev) => ev.type === 'status' && ev.status === 'error'
      )
      const errors = chatEvents().filter((ev) => ev.type === 'error')
      expect(statusErrors).toHaveLength(1)
      expect(errors).toHaveLength(1)
      if (errors[0]?.type === 'error') {
        expect(errors[0].message).toBe('boom')
      }
      expect(chatEvents().map((event) => event.type)).toEqual([
        'text_delta',
        'error',
        'status'
      ])
    })

    it('stamps the invoke on streamed and catch-path events', async () => {
      runAgentMock.mockImplementation(async function* () {
        yield { type: 'text_delta', runId: 'run-test', text: 'partial' } satisfies AgentEvent
        throw new Error('boom')
      })

      const handler = handlers.get(IPC.chatStart)
      await handler!({ sender: mockWc }, chatStartPayload)
      await flushAsync()

      const events = chatEvents()
      expect(events.length).toBeGreaterThan(0)
      for (const ev of events) {
        expect(ev.invokeId).toBe(42)
      }
    })

    it('reuses existing runId when run exists and is not active', async () => {
      runExistsMock.mockReturnValue(true)
      isActiveMock.mockReturnValue(false)
      runAgentMock.mockImplementation(async function* () {
        yield { type: 'status', runId: 'existing-run', status: 'done' } satisfies AgentEvent
      })

      const handler = handlers.get(IPC.chatStart)
      const result = await handler!(
        { sender: mockWc },
        {
          messages: [{ role: 'user' as const, content: 'follow up' }],
          workspacePath: '/ws',
          runId: 'existing-run'
        }
      )

      expect(result).toEqual({ ok: true, data: { runId: 'existing-run', invokeId: 42 } })
      expect(runAgentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'existing-run',
          resume: true
        })
      )
    })

    it('rejects chatStart when requested run is already active', async () => {
      runExistsMock.mockReturnValue(true)
      isActiveMock.mockReturnValue(true)

      const handler = handlers.get(IPC.chatStart)
      const result = await handler!(
        { sender: mockWc },
        {
          messages: [{ role: 'user' as const, content: 'follow up' }],
          workspacePath: '/ws',
          runId: 'busy-run'
        }
      )

      expect(result).toEqual({ ok: false, error: 'Run is already active' })
      expect(runAgentMock).not.toHaveBeenCalled()
    })

    it('marks turn complete on terminal status; clearRunAbort owned by runAgent', async () => {
      runAgentMock.mockImplementation(async function* () {
        yield { type: 'status', runId: 'run-test', status: 'done' } satisfies AgentEvent
      })

      const handler = handlers.get(IPC.chatStart)
      await handler!({ sender: mockWc }, chatStartPayload)
      await flushAsync()

      expect(markRunTurnCompleteMock).toHaveBeenCalledWith('run-test', 42)
      // clearRunAbort is owned by runAgent's finally (mocked here).
      expect(clearRunAbortMock).not.toHaveBeenCalled()
    })
  })

  describe('chatRewindAndStart', () => {
    const rewindPayload = {
      workspacePath: '/ws',
      runId: 'run-edit',
      editMessageIndex: 0,
      editedUserMessage: { role: 'user' as const, content: 'edited' }
    }

    it('registers the run before preparing rewind on disk', async () => {
      const order: string[] = []
      tryRegisterRunAbortMock.mockImplementation(() => {
        order.push('register')
        return { ok: true as const, controller: new AbortController(), invokeId: 7 }
      })
      prepareRewindMock.mockImplementation(async () => {
        order.push('prepare')
        return {
          messages: [{ role: 'user' as const, content: 'edited' }],
          writes: { restored: [], checkpointIds: [] }
        }
      })
      runExistsMock.mockReturnValue(true)
      runAgentMock.mockImplementation(async function* () {
        yield { type: 'status', runId: 'run-edit', status: 'done' } satisfies AgentEvent
      })

      const handler = handlers.get(IPC.chatRewindAndStart)
      const result = await handler!({ sender: mockWc }, rewindPayload)

      expect(result).toEqual({ ok: true, data: { runId: 'run-edit', invokeId: 7 } })
      expect(order).toEqual(['register', 'prepare'])
    })

    it('clears the run slot when rewind prepare fails after register', async () => {
      runExistsMock.mockReturnValue(true)
      prepareRewindMock.mockRejectedValue(new Error('editMessageIndex out of range'))

      const handler = handlers.get(IPC.chatRewindAndStart)
      const result = await handler!({ sender: mockWc }, rewindPayload)

      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining('editMessageIndex out of range'),
        code: 'IPC_HANDLER'
      })
      expect(tryRegisterRunAbortMock).toHaveBeenCalledWith('run-edit', '/ws')
      expect(clearRunAbortMock).toHaveBeenCalledWith('run-edit', 42)
      expect(runAgentMock).not.toHaveBeenCalled()
    })
  })
})
