import { ipcMain, BrowserWindow, shell, nativeTheme } from 'electron'
import { ZodError } from 'zod'
import { IPC } from '../../shared/channels'
import {
  ChatStartRequestSchema,
  CancelRunRequestSchema,
  SetSettingsRequestSchema,
  SetSecretRequestSchema,
  ClearSecretRequestSchema,
  ListModelsRequestSchema,
  ListRunsRequestSchema,
  LoadRunRequestSchema,
  LoadRunEventsRequestSchema,
  LoadToolResultRequestSchema,
  OpenHarnessRequestSchema,
  DeleteRunRequestSchema,
  RenameRunRequestSchema,
  WorkspacesAddRequestSchema,
  WorkspacesRemoveRequestSchema,
  WorkspacesSetActiveRequestSchema,
  WorkspacesUpdateUiStateRequestSchema,
  WorkspacesSetSettingsOverrideRequestSchema,
  ok,
  fail,
  type IpcResult,
  type Settings,
  type AgentEvent,
  type ChatMessage,
  type ListRunsResult,
  type RunSummary,
  type SecretsStatus,
  type ListModelsResult,
  type PersistedEvent,
  type TelemetryStatus,
  type McpStatusResult,
  type WorkspacesState,
  type ActiveRunsResult
} from '../../shared/ipc'
import { resolveOllamaListBaseUrl } from '../../shared/providers'
import { existsSync, mkdirSync } from 'fs'
import { formatError, AppError, isAbortError } from '../../shared/errors'
import { logger, logErrorSummary } from '../../shared/logger'
import { pickWorkspace } from '@main/workspace/workspace'
import { openHarness } from '@main/agent/harness'
import { getSettings, setSettings } from '@main/settings/settings'
import { syncMcpServers, getMcpServerStatus, refreshMcpServers } from '@main/agent/mcp'
import { setSecret, clearSecret, getSecret, secretStatus } from '@main/settings/secrets'
import { ChatEventBatcher } from './streamBatch'
import { runAgent, createRunId } from '../agent/loop'
import { listProviderModels } from '../agent/providers'
import { clearModelCache } from '../agent/providers/modelCache'
import {
  chatCancelResult,
  listActiveRuns,
  registerRunAbort,
  isActive,
  clearRunAbort,
  markRunTurnComplete
} from '../agent/runRegistry'
import {
  listRuns,
  loadMessages,
  loadEventsForRun,
  loadToolResultContent,
  deleteRun,
  renameRun,
  runExists
} from '../agent/state'
import {
  getWorkspaces,
  addWorkspace,
  removeWorkspace,
  setActiveWorkspace,
  updateWorkspaceUiState,
  setWorkspaceSettingsOverride
} from '@main/workspace/workspaces'
import { workspacePathsEqual } from '../../shared/workspacePath'
import { applyTitleBarTheme } from '@main/app/window'
import { logsDirectory } from '../logging/init'
import { applySentryTelemetry, isSentryBuildConfigured } from '../logging/sentry'

export { chatCancelResult }

function senderOk(event: Electron.IpcMainInvokeEvent): boolean {
  const win = BrowserWindow.fromWebContents(event.sender)
  return Boolean(win && !win.isDestroyed())
}

function isTerminalStatusEvent(ev: AgentEvent): boolean {
  return (
    ev.type === 'status' &&
    (ev.status === 'cancelled' || ev.status === 'error' || ev.status === 'done')
  )
}

function isTerminalChatEvent(ev: AgentEvent): boolean {
  return ev.type === 'error' || isTerminalStatusEvent(ev)
}

function failFrom(err: unknown, channel: string, correlationId?: string): IpcResult<never> {
  const isValidation = err instanceof ZodError || (err instanceof AppError && err.code === 'IPC_VALIDATION')
  const message = formatError(err)
  const logLine = isValidation
    ? `IPC validation failed: ${logErrorSummary(err, 'IPC_VALIDATION')}`
    : isAbortError(err)
      ? `IPC aborted: ${logErrorSummary(err)}`
      : `IPC handler failed: ${logErrorSummary(err, 'IPC_HANDLER')}`
  const code = isValidation ? 'IPC_VALIDATION' : isAbortError(err) ? undefined : 'IPC_HANDLER'
  if (isValidation) {
    logger.warn(logLine, {
      scope: 'ipc',
      code: 'IPC_VALIDATION',
      channel,
      correlationId,
      err
    })
  } else if (isAbortError(err)) {
    logger.warn(logLine, {
      scope: 'ipc',
      channel,
      correlationId,
      err
    })
  } else {
    logger.error(logLine, {
      scope: 'ipc',
      code,
      channel,
      correlationId,
      err
    })
  }
  return fail(message)
}

export function registerIpc(): void {
  ipcMain.handle(IPC.pickWorkspace, async (event): Promise<IpcResult<string | null>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      return ok(await pickWorkspace(win))
    } catch (err) {
      return failFrom(err, IPC.pickWorkspace)
    }
  })

  ipcMain.handle(IPC.workspacesGet, async (event): Promise<IpcResult<WorkspacesState>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      return ok(getWorkspaces())
    } catch (err) {
      return failFrom(err, IPC.workspacesGet)
    }
  })

  ipcMain.handle(
    IPC.workspacesAdd,
    async (event, raw): Promise<IpcResult<WorkspacesState>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const req = WorkspacesAddRequestSchema.parse(raw ?? {})
        const win = BrowserWindow.fromWebContents(event.sender)
        return ok(await addWorkspace(win, req.path))
      } catch (err) {
        return failFrom(err, IPC.workspacesAdd)
      }
    }
  )

  ipcMain.handle(
    IPC.workspacesRemove,
    async (event, raw): Promise<IpcResult<WorkspacesState>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const { path } = WorkspacesRemoveRequestSchema.parse(raw)
        return ok(removeWorkspace(path))
      } catch (err) {
        return failFrom(err, IPC.workspacesRemove)
      }
    }
  )

  ipcMain.handle(
    IPC.workspacesSetActive,
    async (event, raw): Promise<IpcResult<WorkspacesState>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const { path } = WorkspacesSetActiveRequestSchema.parse(raw)
        return ok(setActiveWorkspace(path))
      } catch (err) {
        return failFrom(err, IPC.workspacesSetActive)
      }
    }
  )

  ipcMain.handle(
    IPC.workspacesUpdateUiState,
    async (event, raw): Promise<IpcResult<true>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const { path, ui } = WorkspacesUpdateUiStateRequestSchema.parse(raw)
        return ok(updateWorkspaceUiState(path, ui))
      } catch (err) {
        return failFrom(err, IPC.workspacesUpdateUiState)
      }
    }
  )

  ipcMain.on(IPC.workspacesUpdateUiStateSync, (event, raw) => {
    if (!senderOk(event)) return
    try {
      const { path, ui } = WorkspacesUpdateUiStateRequestSchema.parse(raw)
      updateWorkspaceUiState(path, ui)
    } catch (err) {
      logger.warn('Sync UI state update failed', {
        scope: 'ipc',
        channel: IPC.workspacesUpdateUiStateSync,
        err
      })
    }
  })

  ipcMain.handle(
    IPC.workspacesSetSettingsOverride,
    async (event, raw): Promise<IpcResult<WorkspacesState>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const { path, override } = WorkspacesSetSettingsOverrideRequestSchema.parse(raw)
        return ok(setWorkspaceSettingsOverride(path, override))
      } catch (err) {
        return failFrom(err, IPC.workspacesSetSettingsOverride)
      }
    }
  )

  ipcMain.handle(IPC.getSettings, async (event): Promise<IpcResult<Settings>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      return ok(getSettings())
    } catch (err) {
      return failFrom(err, IPC.getSettings)
    }
  })

  ipcMain.handle(IPC.setSettings, async (event, raw): Promise<IpcResult<Settings>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const partial = SetSettingsRequestSchema.parse(raw)
      const next = setSettings(partial)
      if (partial.theme !== undefined) applyTitleBarTheme(partial.theme)
      if (partial.telemetryEnabled !== undefined) {
        applySentryTelemetry(next.telemetryEnabled)
      }
      if (partial.mcpServers !== undefined) {
        await syncMcpServers(next.mcpServers)
      }
      return ok(next)
    } catch (err) {
      return failFrom(err, IPC.setSettings)
    }
  })

  ipcMain.handle(IPC.setSecret, async (event, raw): Promise<IpcResult<true>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const { provider, key } = SetSecretRequestSchema.parse(raw)
      setSecret(provider, key)
      clearModelCache()
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.setSecret)
    }
  })

  ipcMain.handle(IPC.clearSecret, async (event, raw): Promise<IpcResult<true>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const { provider } = ClearSecretRequestSchema.parse(raw)
      clearSecret(provider)
      clearModelCache()
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.clearSecret)
    }
  })

  ipcMain.handle(
    IPC.secretStatus,
    async (event): Promise<IpcResult<SecretsStatus>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        return ok(secretStatus())
      } catch (err) {
        return failFrom(err, IPC.secretStatus)
      }
    }
  )

  ipcMain.handle(
    IPC.listModels,
    async (event, raw): Promise<IpcResult<ListModelsResult>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const req = ListModelsRequestSchema.parse(raw ?? {})
        const settings = getSettings()
        const apiKey = req.provider === 'ollama' ? null : getSecret(req.provider)
        const baseUrl =
          req.provider === 'ollama'
            ? resolveOllamaListBaseUrl(req.baseUrl, settings.ollamaBaseUrl)
            : req.baseUrl
        const result = await listProviderModels({
          provider: req.provider,
          apiKey,
          baseUrl,
          forceRefresh: req.forceRefresh
        })
        return ok(result)
      } catch (err) {
        return failFrom(err, IPC.listModels)
      }
    }
  )

  ipcMain.handle(IPC.chatStart, async (event, raw): Promise<IpcResult<{ runId: string }>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const req = ChatStartRequestSchema.parse(raw)
      const workspaces = getWorkspaces()
      const open = workspaces.openPaths.some((p) => workspacePathsEqual(p, req.workspacePath))
      if (!open) {
        return fail('Workspace is not open')
      }
      if (!existsSync(req.workspacePath)) {
        return fail(`Workspace not found: ${req.workspacePath}`)
      }
      const wc = event.sender
      let runId: string
      let resume = false
      if (req.runId && runExists(req.workspacePath, req.runId)) {
        if (isActive(req.runId)) {
          return fail('Run is already active')
        }
        runId = req.runId
        resume = true
      } else {
        runId = createRunId()
      }
      // Register abort BEFORE return so cancel works during the startup race.
      const { invokeId } = registerRunAbort(runId, req.workspacePath)
      logger.info('Chat start', {
        scope: 'ipc',
        correlationId: runId,
        channel: IPC.chatStart,
        resume
      })

      ;(async () => {
        let terminalSent = false
        const agentInput =
          req.incremental && req.runId && req.newMessages?.length
            ? {
                runId,
                workspacePath: req.workspacePath,
                resume,
                incremental: true as const,
                newMessages: req.newMessages
              }
            : {
                runId,
                messages: req.messages ?? [],
                workspacePath: req.workspacePath,
                resume
              }
        const batcher = new ChatEventBatcher((ev) => {
          if (!wc.isDestroyed()) wc.send(IPC.chatEvent, ev)
        })
        try {
          for await (const ev of runAgent(agentInput)) {
            const terminal = isTerminalChatEvent(ev as AgentEvent)
            if (terminal) terminalSent = true
            batcher.push(ev as AgentEvent)
            // Mark the turn complete so follow-ups can start, but keep the invoke
            // registered until this async handler finishes (generation-aware clear).
            if (terminal) markRunTurnComplete(runId, invokeId)
          }
        } catch (err) {
          if (isAbortError(err)) {
            logger.warn('Chat run aborted', {
              scope: 'ipc',
              correlationId: runId
            })
            if (!terminalSent && !wc.isDestroyed()) {
              wc.send(IPC.chatEvent, {
                type: 'status',
                runId,
                status: 'cancelled'
              } satisfies AgentEvent)
            }
            return
          }
          const message = formatError(err)
          logger.error(`Chat run crashed: ${logErrorSummary(err, 'AGENT_LOOP')}`, {
            scope: 'ipc',
            code: 'AGENT_LOOP',
            correlationId: runId,
            err
          })
          if (!terminalSent && !wc.isDestroyed()) {
            wc.send(IPC.chatEvent, {
              type: 'error',
              runId,
              message,
              code: 'AGENT_LOOP'
            } satisfies AgentEvent)
            wc.send(IPC.chatEvent, {
              type: 'status',
              runId,
              status: 'error'
            } satisfies AgentEvent)
          }
        } finally {
          batcher.flush()
          clearRunAbort(runId, invokeId)
        }
      })()

      return ok({ runId })
    } catch (err) {
      return failFrom(err, IPC.chatStart)
    }
  })

  ipcMain.handle(IPC.chatCancel, async (event, raw): Promise<IpcResult<true>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const { runId } = CancelRunRequestSchema.parse(raw)
      logger.info('Chat cancel', { scope: 'ipc', correlationId: runId })
      return chatCancelResult(runId)
    } catch (err) {
      return failFrom(err, IPC.chatCancel)
    }
  })

  ipcMain.handle(IPC.listRuns, async (event, raw): Promise<IpcResult<ListRunsResult>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const body = (raw ?? {}) as { workspacePath?: string }
      const workspacePath = body.workspacePath?.trim() ?? ''
      if (!workspacePath) {
        return ok({ runs: [], capped: false })
      }
      const req = ListRunsRequestSchema.parse({ workspacePath })
      return ok(await listRuns(req.workspacePath))
    } catch (err) {
      return failFrom(err, IPC.listRuns)
    }
  })

  ipcMain.handle(
    IPC.loadRun,
    async (event, raw): Promise<IpcResult<{ messages: ChatMessage[]; runId: string }>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const req = LoadRunRequestSchema.parse(raw)
        const messages = loadMessages(req.workspacePath, req.runId)
        return ok({ runId: req.runId, messages })
      } catch (err) {
        return failFrom(err, IPC.loadRun)
      }
    }
  )

  ipcMain.handle(
    IPC.loadRunEvents,
    async (event, raw): Promise<IpcResult<PersistedEvent[]>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const req = LoadRunEventsRequestSchema.parse(raw)
        return ok(loadEventsForRun(req.workspacePath, req.runId))
      } catch (err) {
        return failFrom(err, IPC.loadRunEvents)
      }
    }
  )

  ipcMain.handle(IPC.loadToolResult, async (event, raw): Promise<IpcResult<{ content: string }>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const req = LoadToolResultRequestSchema.parse(raw)
      const content = await loadToolResultContent(
        req.workspacePath,
        req.runId,
        req.toolCallId
      )
      if (content == null) return fail('Tool result not found')
      return ok({ content })
    } catch (err) {
      return failFrom(err, IPC.loadToolResult)
    }
  })

  ipcMain.handle(IPC.runsDelete, async (event, raw): Promise<IpcResult<true>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const req = DeleteRunRequestSchema.parse(raw)
      const result = deleteRun(req.workspacePath, req.runId)
      if (!result.ok) return fail(result.error)
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.runsDelete)
    }
  })

  ipcMain.handle(
    IPC.runsRename,
    async (event, raw): Promise<IpcResult<RunSummary>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const req = RenameRunRequestSchema.parse(raw)
        return ok(renameRun(req.workspacePath, req.runId, req.goal))
      } catch (err) {
        return failFrom(err, IPC.runsRename)
      }
    }
  )

  ipcMain.handle(IPC.runsActive, async (event): Promise<IpcResult<ActiveRunsResult>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      return ok(listActiveRuns())
    } catch (err) {
      return failFrom(err, IPC.runsActive)
    }
  })

  ipcMain.handle(IPC.openHarness, async (event): Promise<IpcResult<true>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      OpenHarnessRequestSchema.parse({})
      await openHarness()
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.openHarness)
    }
  })

  ipcMain.handle(IPC.logsGetPath, async (event): Promise<IpcResult<string>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      return ok(logsDirectory())
    } catch (err) {
      return failFrom(err, IPC.logsGetPath)
    }
  })

  ipcMain.handle(IPC.logsOpenDir, async (event): Promise<IpcResult<true>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const dir = logsDirectory()
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const result = await shell.openPath(dir)
      if (result) {
        logger.warn('Failed to open logs directory', {
          scope: 'ipc',
          code: 'IPC_HANDLER',
          channel: IPC.logsOpenDir,
          message: result
        })
        return fail(result)
      }
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.logsOpenDir)
    }
  })

  ipcMain.handle(IPC.telemetryStatus, async (event): Promise<IpcResult<TelemetryStatus>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      return ok({
        dsnConfigured: isSentryBuildConfigured(),
        telemetryEnabled: getSettings().telemetryEnabled
      })
    } catch (err) {
      return failFrom(err, IPC.telemetryStatus)
    }
  })

  ipcMain.handle(IPC.mcpStatus, async (event): Promise<IpcResult<McpStatusResult>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      return ok({ servers: getMcpServerStatus(getSettings().mcpServers) })
    } catch (err) {
      return failFrom(err, IPC.mcpStatus)
    }
  })

  ipcMain.handle(IPC.mcpRefresh, async (event): Promise<IpcResult<McpStatusResult>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const servers = await refreshMcpServers(getSettings().mcpServers)
      return ok({ servers })
    } catch (err) {
      return failFrom(err, IPC.mcpRefresh)
    }
  })

  ipcMain.handle(IPC.windowMinimize, async (event): Promise<IpcResult<true>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return fail('No window')
      win.minimize()
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.windowMinimize)
    }
  })

  ipcMain.handle(IPC.windowMaximize, async (event): Promise<IpcResult<boolean>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return fail('No window')
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return ok(win.isMaximized())
    } catch (err) {
      return failFrom(err, IPC.windowMaximize)
    }
  })

  ipcMain.handle(IPC.windowClose, async (event): Promise<IpcResult<true>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return fail('No window')
      win.close()
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.windowClose)
    }
  })

  ipcMain.handle(IPC.windowIsMaximized, async (event): Promise<IpcResult<boolean>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return fail('No window')
      return ok(win.isMaximized())
    } catch (err) {
      return failFrom(err, IPC.windowIsMaximized)
    }
  })

  ipcMain.handle(IPC.getSystemTheme, async (event): Promise<IpcResult<boolean>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      return ok(nativeTheme.shouldUseDarkColors)
    } catch (err) {
      return failFrom(err, IPC.getSystemTheme)
    }
  })
}
