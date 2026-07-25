import { z } from 'zod'
import { ProviderIdSchema, ServiceTierSchema } from './providers'

export const ThinkingEffortSchema = z.enum([
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
])
export type ThinkingEffort = z.infer<typeof ThinkingEffortSchema>

export const ThemeIdSchema = z.enum(['system', 'light', 'dark'])
export type ThemeId = z.infer<typeof ThemeIdSchema>

export const McpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true)
})
export type McpServer = z.infer<typeof McpServerSchema>

const ThinkingPrefsSchema = z.object({
  thinkingEnabled: z.boolean(),
  thinkingEffort: ThinkingEffortSchema
})

/**
 * `mutating` gates only tools that change the workspace or run commands;
 * `all` gates every tool including reads. Default is `off` — approval is opt-in.
 */
export const ToolApprovalModeSchema = z.enum(['off', 'mutating', 'all'])
export type ToolApprovalMode = z.infer<typeof ToolApprovalModeSchema>

export const ToolApprovalSettingsSchema = z.object({
  mode: ToolApprovalModeSchema.default('off'),
  /** Tool names the user chose to always allow, persisted per workspace. */
  allowlist: z.array(z.string()).default([])
})
export type ToolApprovalSettings = z.infer<typeof ToolApprovalSettingsSchema>

export const DEFAULT_TOOL_APPROVAL: ToolApprovalSettings = { mode: 'off', allowlist: [] }

export const SettingsSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().min(1),
  ollamaBaseUrl: z.string().min(1),
  maxSteps: z.number().int().min(1).max(100),
  theme: ThemeIdSchema,
  telemetryEnabled: z.boolean().default(false),
  mcpServers: z.array(McpServerSchema).default([]),
  compactionTriggerRatio: z.number().min(0.5).max(0.95).default(0.7),
  keepRecentTurns: z.number().int().min(4).max(50).default(12),
  memoryAutoPromote: z.boolean().default(true),
  thinkingEnabled: z.boolean().default(true),
  thinkingEffort: ThinkingEffortSchema.default('medium'),
  showThinking: z.boolean().default(true),
  favoriteModels: z.array(z.string()).default([]),
  recentModels: z.array(z.string()).max(5).default([]),
  thinkingPrefsByProvider: z.record(ProviderIdSchema, ThinkingPrefsSchema).default({}),
  serviceTierByModel: z.record(z.string(), ServiceTierSchema).default({}),
  serviceTier: ServiceTierSchema.default('default'),
  toolApproval: ToolApprovalSettingsSchema.default(DEFAULT_TOOL_APPROVAL)
})
export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  provider: 'ollama',
  model: 'qwen2.5',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  maxSteps: 25,
  theme: 'system',
  telemetryEnabled: false,
  mcpServers: [],
  compactionTriggerRatio: 0.7,
  keepRecentTurns: 12,
  memoryAutoPromote: true,
  thinkingEnabled: true,
  thinkingEffort: 'medium',
  showThinking: true,
  favoriteModels: [],
  recentModels: [],
  thinkingPrefsByProvider: {},
  serviceTierByModel: {},
  serviceTier: 'default',
  toolApproval: DEFAULT_TOOL_APPROVAL
}

export const SetSettingsRequestSchema = SettingsSchema.partial()
export type SetSettingsRequest = z.infer<typeof SetSettingsRequestSchema>

export const WindowMaximizedChangedSchema = z.boolean()

export const TelemetryStatusSchema = z.object({
  dsnConfigured: z.boolean(),
  telemetryEnabled: z.boolean()
})
export type TelemetryStatus = z.infer<typeof TelemetryStatusSchema>

export function parseSettings(data: unknown): Settings {
  return SettingsSchema.parse(data)
}
