import type {
  ActiveRunsResult,
  AgentEvent,
  ChatMessage,
  ChatStartRequest,
  IpcResult,
  ListModelsResult,
  ListRunsResult,
  PersistedEvent,
  ProviderId,
  RunSummary,
  SecretProvider,
  SecretsStatus,
  Settings,
  TelemetryStatus,
  McpStatusResult,
  WorkspaceSettingsOverride,
  WorkspacesState,
  WorkspaceUiState
} from './ipc'

/** Host OS from preload `process.platform`. */
export type HostPlatform = 'darwin' | 'win32' | 'linux' | string

/**
 * Single source of truth for the contextBridge API.
 * Preload implements this; renderer `env.d.ts` types `window.vyotiq` from it.
 */
export interface VyotiqApi {
  platform: HostPlatform
  pickWorkspace: () => Promise<IpcResult<string | null>>
  getWorkspaces: () => Promise<IpcResult<WorkspacesState>>
  addWorkspace: (path?: string) => Promise<IpcResult<WorkspacesState>>
  removeWorkspace: (path: string) => Promise<IpcResult<WorkspacesState>>
  setActiveWorkspace: (path: string) => Promise<IpcResult<WorkspacesState>>
  updateWorkspaceUiState: (path: string, ui: WorkspaceUiState) => Promise<IpcResult<true>>
  /** Fire-and-forget UI state flush (e.g. beforeunload). */
  updateWorkspaceUiStateSync: (path: string, ui: WorkspaceUiState) => void
  setWorkspaceSettingsOverride: (
    path: string,
    override: WorkspaceSettingsOverride | null
  ) => Promise<IpcResult<WorkspacesState>>
  getSettings: () => Promise<IpcResult<Settings>>
  setSettings: (partial: Partial<Settings>) => Promise<IpcResult<Settings>>
  setSecret: (provider: SecretProvider, key: string) => Promise<IpcResult<true>>
  clearSecret: (provider: SecretProvider) => Promise<IpcResult<true>>
  secretStatus: () => Promise<IpcResult<SecretsStatus>>
  listModels: (payload: {
    provider: ProviderId
    baseUrl?: string
    forceRefresh?: boolean
  }) => Promise<IpcResult<ListModelsResult>>
  chatStart: (payload: ChatStartRequest) => Promise<IpcResult<{ runId: string }>>
  chatCancel: (runId: string) => Promise<IpcResult<true>>
  onChatEvent: (handler: (event: AgentEvent) => void) => () => void
  listRuns: (workspacePath: string) => Promise<IpcResult<ListRunsResult>>
  loadRun: (
    workspacePath: string,
    runId: string
  ) => Promise<IpcResult<{ messages: ChatMessage[]; runId: string }>>
  loadRunEvents: (
    workspacePath: string,
    runId: string
  ) => Promise<IpcResult<PersistedEvent[]>>
  loadToolResult: (
    workspacePath: string,
    runId: string,
    toolCallId: string
  ) => Promise<IpcResult<{ content: string }>>
  deleteRun: (workspacePath: string, runId: string) => Promise<IpcResult<true>>
  renameRun: (
    workspacePath: string,
    runId: string,
    goal: string
  ) => Promise<IpcResult<RunSummary>>
  listActiveRuns: () => Promise<IpcResult<ActiveRunsResult>>
  openHarness: () => Promise<IpcResult<true>>
  windowMinimize: () => Promise<IpcResult<true>>
  windowMaximize: () => Promise<IpcResult<boolean>>
  windowClose: () => Promise<IpcResult<true>>
  windowIsMaximized: () => Promise<IpcResult<boolean>>
  onWindowMaximizedChanged: (handler: (maximized: boolean) => void) => () => void
  openLogsDir: () => Promise<IpcResult<true>>
  getLogsPath: () => Promise<IpcResult<string>>
  telemetryStatus: () => Promise<IpcResult<TelemetryStatus>>
  mcpStatus: () => Promise<IpcResult<McpStatusResult>>
  mcpRefresh: () => Promise<IpcResult<McpStatusResult>>
  getSystemTheme: () => Promise<IpcResult<boolean>>
  onSystemThemeChanged: (handler: (prefersDark: boolean) => void) => () => void
}
