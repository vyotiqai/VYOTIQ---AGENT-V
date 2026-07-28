import { ipcMain, BrowserWindow, shell, nativeTheme, dialog } from 'electron'
import { ZodError, z } from 'zod'
import { IPC } from '../../shared/channels'
import {
  ChatStartRequestSchema,
  CancelRunRequestSchema,
  CompactRunRequestSchema,
  SetSettingsRequestSchema,
  SetSecretRequestSchema,
  ClearSecretRequestSchema,
  ListModelsRequestSchema,
  ListRunsRequestSchema,
  LoadRunRequestSchema,
  LoadRunEventsRequestSchema,
  LoadToolResultRequestSchema,
  DeleteRunRequestSchema,
  RenameRunRequestSchema,
  WorkspacesAddRequestSchema,
  WorkspacesRemoveRequestSchema,
  WorkspacesSetActiveRequestSchema,
  WorkspacesUpdateUiStateRequestSchema,
  WorkspacesSetSettingsOverrideRequestSchema,
  GitStatusRequestSchema,
  GitCommitRequestSchema,
  ToolApprovalResponseSchema,
  ExtractAttachmentRequestSchema,
  MarketplaceBrowseRequestSchema,
  MarketplaceInstallRequestSchema,
  MarketplaceSetEnabledRequestSchema,
  MarketplaceUninstallRequestSchema,
  ok,
  fail,
  type ExtractAttachmentResult,
  type IpcResult,
  type Settings,
  type AgentEvent,
  type ChatStartResult,
  type ChatMessage,
  type CompactRunResult,
  type ListRunsResult,
  type RunSummary,
  type SecretsStatus,
  type ListModelsResult,
  type PersistedEvent,
  type TelemetryStatus,
  type McpStatusResult,
  type WorkspacesState,
  type ActiveRunsResult,
  type GitStatus,
  type GitCommitResult
} from '../../shared/ipc'
import { resolveOllamaListBaseUrl } from '../../shared/providers'
import { existsSync, mkdirSync } from 'fs'
import { formatError, AppError, isAbortError } from '../../shared/errors'
import { logger, logErrorSummary } from '../../shared/logger'
import { pickWorkspace } from '@main/workspace/workspace'
import { getSettings, setSettings } from '@main/settings/settings'
import { syncMcpServers, getMcpServerStatus, refreshMcpServers, startMcpOAuth } from '@main/agent/mcp'
import { headersWithoutAuthorization } from '../../shared/utils/mcpAuth'
import {
  browseCatalog,
  refreshRemoteCatalog,
  readMarketplaceIndex,
  installMarketplacePackage,
  removeInstalledItem,
  setInstalledEnabled,
  syncMarketplaceMcpIntoSettings,
  resolveEffectiveMcpServers,
  getInstalledPackageContents
} from '@main/marketplace'
import {
  setSecret,
  clearSecret,
  getSecret,
  secretStatus,
  setMcpAuthToken,
  clearMcpAuthToken,
  clearMcpOAuthState
} from '@main/settings/secrets'
import { ChatEventBatcher } from './streamBatch'
import { runAgent, createRunId } from '../agent/loop'
import { compactRunNow, CompactionUnavailableError } from '../agent/compactRun'
import { extractAttachment } from '../attachments/extract'
import {
  cancelPendingApprovals,
  registerApprovalSender,
  resolveToolApproval
} from '../agent/toolApproval'
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
import { commitAll, readGitStatus } from '@main/git/git'
import { applyTitleBarTheme } from '@main/app/window'
import { logsDirectory } from '../logging/init'
import { applySentryTelemetry, isSentryBuildConfigured } from '../logging/sentry'

export { chatCancelResult }

function senderOk(event: Electron.IpcMainInvokeEvent): boolean {
  const win = BrowserWindow.fromWebContents(event.sender)
  return Boolean(win && !win.isDestroyed())
}

/** Git runs commands in a directory, so only ever in one the user has opened. */
function isOpenWorkspace(path: string): boolean {
  return getWorkspaces().openPaths.some((open) => workspacePathsEqual(open, path))
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
      if (partial.mcpServers !== undefined || partial.marketplace !== undefined) {
        await syncMcpServers(resolveEffectiveMcpServers())
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

  ipcMain.handle(IPC.chatStart, async (event, raw): Promise<IpcResult<ChatStartResult>> => {
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
        // Stamp the invoke on every event so the renderer can tell a live event apart
        // from one arriving late from the previous turn of the same run.
        const sendEvent = (ev: AgentEvent): void => {
          if (!wc.isDestroyed()) wc.send(IPC.chatEvent, { ...ev, invokeId })
        }
        const batcher = new ChatEventBatcher(sendEvent)
        const releaseApprovalSender = registerApprovalSender(runId, (request) => {
          // The gate is parked on this prompt, so it has to jump the event batcher.
          batcher.flush()
          if (!wc.isDestroyed()) wc.send(IPC.toolApprovalRequest, request)
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
            if (!terminalSent) {
              sendEvent({ type: 'status', runId, status: 'cancelled' })
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
          if (!terminalSent) {
            sendEvent({ type: 'error', runId, message, code: 'AGENT_LOOP' })
            sendEvent({ type: 'status', runId, status: 'error' })
          }
        } finally {
          batcher.flush()
          releaseApprovalSender()
          cancelPendingApprovals(runId, invokeId)
          clearRunAbort(runId, invokeId)
        }
      })()

      return ok({ runId, invokeId })
    } catch (err) {
      return failFrom(err, IPC.chatStart)
    }
  })

  ipcMain.handle(IPC.toolApprovalResponse, async (event, raw): Promise<IpcResult<boolean>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const response = ToolApprovalResponseSchema.parse(raw)
      return ok(resolveToolApproval(response))
    } catch (err) {
      return failFrom(err, IPC.toolApprovalResponse)
    }
  })

  ipcMain.handle(
    IPC.attachmentExtract,
    async (event, raw): Promise<IpcResult<ExtractAttachmentResult>> => {
      if (!senderOk(event)) return fail('Invalid sender')
      try {
        const req = ExtractAttachmentRequestSchema.parse(raw)
        return ok(await extractAttachment(req))
      } catch (err) {
        return failFrom(err, IPC.attachmentExtract)
      }
    }
  )

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

  ipcMain.handle(IPC.chatCompact, async (event, raw): Promise<IpcResult<CompactRunResult>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const req = CompactRunRequestSchema.parse(raw)
      if (!isOpenWorkspace(req.workspacePath)) return fail('Workspace is not open')
      if (isActive(req.runId)) {
        return fail('Stop the run before compacting its history.')
      }
      logger.info('Manual compaction requested', {
        scope: 'ipc',
        correlationId: req.runId,
        channel: IPC.chatCompact
      })
      return ok(await compactRunNow(req))
    } catch (err) {
      if (err instanceof CompactionUnavailableError) return fail(err.message)
      return failFrom(err, IPC.chatCompact)
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
      if (!isOpenWorkspace(req.workspacePath)) return fail('Workspace is not open')
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
        if (!isOpenWorkspace(req.workspacePath)) return fail('Workspace is not open')
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
        if (!isOpenWorkspace(req.workspacePath)) return fail('Workspace is not open')
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
      if (!isOpenWorkspace(req.workspacePath)) return fail('Workspace is not open')
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
      if (!isOpenWorkspace(req.workspacePath)) return fail('Workspace is not open')
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
        if (!isOpenWorkspace(req.workspacePath)) return fail('Workspace is not open')
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

  ipcMain.handle(IPC.gitStatus, async (event, raw): Promise<IpcResult<GitStatus | null>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const req = GitStatusRequestSchema.parse(raw)
      if (!isOpenWorkspace(req.workspacePath)) return fail('Workspace is not open')
      return ok(await readGitStatus(req.workspacePath))
    } catch (err) {
      return failFrom(err, IPC.gitStatus)
    }
  })

  ipcMain.handle(IPC.gitCommit, async (event, raw): Promise<IpcResult<GitCommitResult>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const req = GitCommitRequestSchema.parse(raw)
      if (!isOpenWorkspace(req.workspacePath)) return fail('Workspace is not open')
      return ok(await commitAll(req.workspacePath, req.message, req.push === true))
    } catch (err) {
      return failFrom(err, IPC.gitCommit)
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
      const servers = resolveEffectiveMcpServers()
      return ok({ servers: getMcpServerStatus(servers) })
    } catch (err) {
      return failFrom(err, IPC.mcpStatus)
    }
  })

  ipcMain.handle(IPC.mcpRefresh, async (event): Promise<IpcResult<McpStatusResult>> => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const servers = await refreshMcpServers(resolveEffectiveMcpServers())
      return ok({ servers })
    } catch (err) {
      return failFrom(err, IPC.mcpRefresh)
    }
  })

  ipcMain.handle(IPC.mcpSetAuthToken, async (event, raw) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const { serverId, token } = z
        .object({ serverId: z.string().min(1), token: z.string().min(1) })
        .parse(raw)
      setMcpAuthToken(serverId, token)
      const settings = getSettings()
      const nextServers = (settings.mcpServers ?? []).map((s) =>
        s.id === serverId
          ? { ...s, headers: headersWithoutAuthorization(s.headers) }
          : s
      )
      setSettings({ mcpServers: nextServers })
      await syncMcpServers(resolveEffectiveMcpServers())
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.mcpSetAuthToken)
    }
  })

  ipcMain.handle(IPC.mcpClearAuthToken, async (event, raw) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const { serverId } = z.object({ serverId: z.string().min(1) }).parse(raw)
      clearMcpAuthToken(serverId)
      clearMcpOAuthState(serverId)
      const settings = getSettings()
      const nextServers = (settings.mcpServers ?? []).map((s) =>
        s.id === serverId
          ? { ...s, headers: headersWithoutAuthorization(s.headers) }
          : s
      )
      setSettings({ mcpServers: nextServers })
      await syncMcpServers(resolveEffectiveMcpServers())
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.mcpClearAuthToken)
    }
  })

  ipcMain.handle(IPC.mcpStartOAuth, async (event, raw) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const { serverId } = z.object({ serverId: z.string().min(1) }).parse(raw)
      await startMcpOAuth(serverId)
      return ok(true)
    } catch (err) {
      return failFrom(err, IPC.mcpStartOAuth)
    }
  })

  ipcMain.handle(IPC.marketplaceListInstalled, async (event) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      return ok(readMarketplaceIndex())
    } catch (err) {
      return failFrom(err, IPC.marketplaceListInstalled)
    }
  })

  ipcMain.handle(IPC.marketplaceBrowse, async (event, raw) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const req = MarketplaceBrowseRequestSchema.parse(raw ?? {})
      const packages = await browseCatalog(req)
      return ok({ packages })
    } catch (err) {
      return failFrom(err, IPC.marketplaceBrowse)
    }
  })

  ipcMain.handle(IPC.marketplaceRefreshCatalog, async (event) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const remote = await refreshRemoteCatalog()
      const packages = await browseCatalog()
      return ok({ packages, remoteCount: remote.packages.length })
    } catch (err) {
      return failFrom(err, IPC.marketplaceRefreshCatalog)
    }
  })

  ipcMain.handle(IPC.marketplaceInstall, async (event, raw) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const req = MarketplaceInstallRequestSchema.parse(raw)
      const item = await installMarketplacePackage(req)
      await syncMcpServers(resolveEffectiveMcpServers())
      return ok(item)
    } catch (err) {
      return failFrom(err, IPC.marketplaceInstall)
    }
  })

  ipcMain.handle(IPC.marketplaceUninstall, async (event, raw) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const { id } = MarketplaceUninstallRequestSchema.parse(raw)
      const index = removeInstalledItem(id)
      syncMarketplaceMcpIntoSettings()
      await syncMcpServers(resolveEffectiveMcpServers())
      return ok(index)
    } catch (err) {
      return failFrom(err, IPC.marketplaceUninstall)
    }
  })

  ipcMain.handle(IPC.marketplaceSetEnabled, async (event, raw) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const { id, enabled } = MarketplaceSetEnabledRequestSchema.parse(raw)
      const index = setInstalledEnabled(id, enabled)
      const item = index.items.find((i) => i.id === id)
      if (item?.kind === 'mcp' || item?.kind === 'plugin') {
        syncMarketplaceMcpIntoSettings()
        await syncMcpServers(resolveEffectiveMcpServers())
      }
      return ok(index)
    } catch (err) {
      return failFrom(err, IPC.marketplaceSetEnabled)
    }
  })

  ipcMain.handle(IPC.marketplacePickLocal, async (event) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: 'Add marketplace package',
        properties: ['openFile', 'openDirectory'],
        filters: [
          { name: 'Packages', extensions: ['zip', 'tgz', 'json', 'md'] },
          { name: 'All', extensions: ['*'] }
        ]
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return ok(null)
      return ok(result.filePaths[0])
    } catch (err) {
      return failFrom(err, IPC.marketplacePickLocal)
    }
  })

  ipcMain.handle(IPC.marketplaceGetContents, async (event, raw) => {
    if (!senderOk(event)) return fail('Invalid sender')
    try {
      const id = z.string().min(1).parse((raw as { id?: string })?.id)
      const contents = getInstalledPackageContents(id)
      if (!contents) return fail('Package not found')
      return ok(contents)
    } catch (err) {
      return failFrom(err, IPC.marketplaceGetContents)
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
