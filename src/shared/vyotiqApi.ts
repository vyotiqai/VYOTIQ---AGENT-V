import type {
  ActiveRunsResult,
  AgentEvent,
  ChatMessage,
  ChatStartRequest,
  ChatStartResult,
  CompactRunResult,
  GitCommitResult,
  GitStatus,
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
  ToolApprovalDecision,
  ToolApprovalRequest,
  ExtractAttachmentRequest,
  ExtractAttachmentResult,
  McpStatusResult,
  MarketplaceIndex,
  MarketplaceCatalogEntry,
  MarketplaceInstallResult,
  MarketplaceInstallRequest,
  MarketplaceBrowseRequest,
  PackageContents,
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
  chatStart: (payload: ChatStartRequest) => Promise<IpcResult<ChatStartResult>>
  chatCancel: (runId: string) => Promise<IpcResult<true>>
  chatCompact: (workspacePath: string, runId: string) => Promise<IpcResult<CompactRunResult>>
  onChatEvent: (handler: (event: AgentEvent) => void) => () => void
  onToolApprovalRequest: (handler: (request: ToolApprovalRequest) => void) => () => void
  respondToolApproval: (
    requestId: string,
    decision: ToolApprovalDecision
  ) => Promise<IpcResult<boolean>>
  extractAttachment: (
    payload: ExtractAttachmentRequest
  ) => Promise<IpcResult<ExtractAttachmentResult>>
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
  /** Resolves to null when the workspace is not a git repository. */
  gitStatus: (workspacePath: string) => Promise<IpcResult<GitStatus | null>>
  gitCommit: (
    workspacePath: string,
    message: string,
    push: boolean
  ) => Promise<IpcResult<GitCommitResult>>
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
  mcpSetAuthToken: (serverId: string, token: string) => Promise<IpcResult<true>>
  mcpClearAuthToken: (serverId: string) => Promise<IpcResult<true>>
  mcpStartOAuth: (serverId: string) => Promise<IpcResult<true>>
  marketplaceListInstalled: () => Promise<IpcResult<MarketplaceIndex>>
  marketplaceBrowse: (
    payload?: MarketplaceBrowseRequest
  ) => Promise<IpcResult<{ packages: MarketplaceCatalogEntry[] }>>
  marketplaceRefreshCatalog: () => Promise<
    IpcResult<{ packages: MarketplaceCatalogEntry[]; remoteCount: number }>
  >
  marketplaceInstall: (
    payload: MarketplaceInstallRequest
  ) => Promise<IpcResult<MarketplaceInstallResult>>
  marketplaceUninstall: (id: string) => Promise<IpcResult<MarketplaceIndex>>
  marketplaceSetEnabled: (
    id: string,
    enabled: boolean
  ) => Promise<IpcResult<MarketplaceIndex>>
  marketplacePickLocal: () => Promise<IpcResult<string | null>>
  marketplaceGetContents: (id: string) => Promise<IpcResult<PackageContents>>
  getSystemTheme: () => Promise<IpcResult<boolean>>
  onSystemThemeChanged: (handler: (prefersDark: boolean) => void) => () => void
}
