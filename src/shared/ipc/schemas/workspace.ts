import { z } from 'zod'
import { ProviderIdSchema } from './providers'
import { ThinkingEffortSchema, ToolApprovalSettingsSchema } from './settings'

export const WorkspaceUiStateSchema = z.object({
  activeRunId: z.string().nullable(),
  openRunIds: z.array(z.string()),
  scrollTop: z.number(),
  scrollTopByRunId: z.record(z.string(), z.number()).default({}),
  composerDraft: z.string()
})
export type WorkspaceUiState = z.infer<typeof WorkspaceUiStateSchema>

export const WorkspaceSettingsOverrideSchema = z.object({
  provider: ProviderIdSchema.optional(),
  model: z.string().min(1).optional(),
  compactionTriggerRatio: z.number().min(0.5).max(0.95).optional(),
  keepRecentTurns: z.number().int().min(4).max(50).optional(),
  memoryAutoPromote: z.boolean().optional(),
  thinkingEnabled: z.boolean().optional(),
  thinkingEffort: ThinkingEffortSchema.optional(),
  showThinking: z.boolean().optional(),
  toolApproval: ToolApprovalSettingsSchema.optional(),
  subagentProvider: ProviderIdSchema.optional(),
  subagentModel: z.string().min(1).optional(),
  useOverride: z.boolean()
})
export type WorkspaceSettingsOverride = z.infer<typeof WorkspaceSettingsOverrideSchema>

export const WorkspacesStateSchema = z.object({
  version: z.literal(2),
  workspaceIdsByPath: z.record(z.string(), z.string()).optional(),
  legacySessionsMigrated: z.boolean(),
  needsWorkspaceForMigration: z.boolean().optional(),
  pendingMigrationCount: z.number().int().nonnegative().optional(),
  openPaths: z.array(z.string()),
  activePath: z.string().nullable(),
  recentPaths: z.array(z.string()),
  uiStateByPath: z.record(z.string(), WorkspaceUiStateSchema),
  settingsOverridesByPath: z.record(z.string(), WorkspaceSettingsOverrideSchema)
})
export type WorkspacesState = z.infer<typeof WorkspacesStateSchema>

export const WorkspacesAddRequestSchema = z.object({
  path: z.string().min(1).optional()
})
export type WorkspacesAddRequest = z.infer<typeof WorkspacesAddRequestSchema>

export const WorkspacesRemoveRequestSchema = z.object({
  path: z.string().min(1)
})
export type WorkspacesRemoveRequest = z.infer<typeof WorkspacesRemoveRequestSchema>

export const WorkspacesSetActiveRequestSchema = z.object({
  path: z.string().min(1)
})
export type WorkspacesSetActiveRequest = z.infer<typeof WorkspacesSetActiveRequestSchema>

export const WorkspacesUpdateUiStateRequestSchema = z.object({
  path: z.string().min(1),
  ui: WorkspaceUiStateSchema
})
export type WorkspacesUpdateUiStateRequest = z.infer<typeof WorkspacesUpdateUiStateRequestSchema>

export const WorkspacesSetSettingsOverrideRequestSchema = z.object({
  path: z.string().min(1),
  override: WorkspaceSettingsOverrideSchema.nullable()
})
export type WorkspacesSetSettingsOverrideRequest = z.infer<
  typeof WorkspacesSetSettingsOverrideRequestSchema
>

export const OpenHarnessRequestSchema = z.object({})
