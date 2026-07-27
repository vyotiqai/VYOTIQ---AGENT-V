import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/channels'
import { AgentEventSchema, ToolApprovalRequestSchema } from '../shared/ipc'
import type { VyotiqApi } from '../shared/vyotiqApi'

export type { HostPlatform, VyotiqApi } from '../shared/vyotiqApi'

// Sentry is initialized in the renderer after settings.telemetryEnabled is known.

const api: VyotiqApi = {
  platform: process.platform,
  pickWorkspace: () => ipcRenderer.invoke(IPC.pickWorkspace),
  getWorkspaces: () => ipcRenderer.invoke(IPC.workspacesGet),
  addWorkspace: (path) => ipcRenderer.invoke(IPC.workspacesAdd, path ? { path } : {}),
  removeWorkspace: (path) => ipcRenderer.invoke(IPC.workspacesRemove, { path }),
  setActiveWorkspace: (path) => ipcRenderer.invoke(IPC.workspacesSetActive, { path }),
  updateWorkspaceUiState: (path, ui) =>
    ipcRenderer.invoke(IPC.workspacesUpdateUiState, { path, ui }),
  updateWorkspaceUiStateSync: (path, ui) =>
    ipcRenderer.send(IPC.workspacesUpdateUiStateSync, { path, ui }),
  setWorkspaceSettingsOverride: (path, override) =>
    ipcRenderer.invoke(IPC.workspacesSetSettingsOverride, { path, override }),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (partial) => ipcRenderer.invoke(IPC.setSettings, partial),
  setSecret: (provider, key) => ipcRenderer.invoke(IPC.setSecret, { provider, key }),
  clearSecret: (provider) => ipcRenderer.invoke(IPC.clearSecret, { provider }),
  secretStatus: () => ipcRenderer.invoke(IPC.secretStatus),
  listModels: (payload) => ipcRenderer.invoke(IPC.listModels, payload),
  chatStart: (payload) => ipcRenderer.invoke(IPC.chatStart, payload),
  chatCancel: (runId) => ipcRenderer.invoke(IPC.chatCancel, { runId }),
  chatCompact: (workspacePath, runId) =>
    ipcRenderer.invoke(IPC.chatCompact, { workspacePath, runId }),
  onChatEvent: (handler) => {
    const listener = (_: IpcRendererEvent, raw: unknown): void => {
      const parsed = AgentEventSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn('[vyotiq] Invalid chat event dropped', parsed.error.issues[0]?.message)
        return
      }
      handler(parsed.data)
    }
    ipcRenderer.on(IPC.chatEvent, listener)
    return () => {
      ipcRenderer.removeListener(IPC.chatEvent, listener)
    }
  },
  onToolApprovalRequest: (handler) => {
    const listener = (_: IpcRendererEvent, raw: unknown): void => {
      const parsed = ToolApprovalRequestSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn('[vyotiq] Invalid approval request dropped', parsed.error.issues[0]?.message)
        return
      }
      handler(parsed.data)
    }
    ipcRenderer.on(IPC.toolApprovalRequest, listener)
    return () => {
      ipcRenderer.removeListener(IPC.toolApprovalRequest, listener)
    }
  },
  respondToolApproval: (requestId, decision) =>
    ipcRenderer.invoke(IPC.toolApprovalResponse, { requestId, decision }),
  extractAttachment: (payload) => ipcRenderer.invoke(IPC.attachmentExtract, payload),
  listRuns: (workspacePath) => {
    const path = workspacePath?.trim() ?? ''
    if (!path) {
      return Promise.resolve({ ok: true as const, data: { runs: [], capped: false } })
    }
    return ipcRenderer.invoke(IPC.listRuns, { workspacePath: path })
  },
  loadRun: (workspacePath, runId) => ipcRenderer.invoke(IPC.loadRun, { workspacePath, runId }),
  loadRunEvents: (workspacePath, runId) =>
    ipcRenderer.invoke(IPC.loadRunEvents, { workspacePath, runId }),
  loadToolResult: (workspacePath, runId, toolCallId) =>
    ipcRenderer.invoke(IPC.loadToolResult, { workspacePath, runId, toolCallId }),
  deleteRun: (workspacePath, runId) =>
    ipcRenderer.invoke(IPC.runsDelete, { workspacePath, runId }),
  renameRun: (workspacePath, runId, goal) =>
    ipcRenderer.invoke(IPC.runsRename, { workspacePath, runId, goal }),
  listActiveRuns: () => ipcRenderer.invoke(IPC.runsActive),
  gitStatus: (workspacePath) => ipcRenderer.invoke(IPC.gitStatus, { workspacePath }),
  gitCommit: (workspacePath, message, push) =>
    ipcRenderer.invoke(IPC.gitCommit, { workspacePath, message, push }),
  windowMinimize: () => ipcRenderer.invoke(IPC.windowMinimize),
  windowMaximize: () => ipcRenderer.invoke(IPC.windowMaximize),
  windowClose: () => ipcRenderer.invoke(IPC.windowClose),
  windowIsMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
  onWindowMaximizedChanged: (handler) => {
    const listener = (_: IpcRendererEvent, maximized: boolean): void => handler(maximized)
    ipcRenderer.on(IPC.windowMaximizedChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC.windowMaximizedChanged, listener)
    }
  },
  openLogsDir: () => ipcRenderer.invoke(IPC.logsOpenDir),
  getLogsPath: () => ipcRenderer.invoke(IPC.logsGetPath),
  telemetryStatus: () => ipcRenderer.invoke(IPC.telemetryStatus),
  mcpStatus: () => ipcRenderer.invoke(IPC.mcpStatus),
  mcpRefresh: () => ipcRenderer.invoke(IPC.mcpRefresh),
  getSystemTheme: () => ipcRenderer.invoke(IPC.getSystemTheme),
  onSystemThemeChanged: (handler) => {
    const listener = (_: IpcRendererEvent, prefersDark: boolean): void => handler(prefersDark)
    ipcRenderer.on(IPC.themeChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC.themeChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('vyotiq', api)
