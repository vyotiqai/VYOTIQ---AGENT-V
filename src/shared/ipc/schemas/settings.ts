import { z } from 'zod'
import { ProviderIdSchema, ServiceTierSchema } from './providers'
import {
  DEFAULT_MARKETPLACE_SETTINGS,
  MarketplaceSettingsSchema,
  McpTransportSchema
} from './marketplace'

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

const McpServerIdSchema = z
  .string()
  .min(1)
  .refine((id) => !id.includes('__'), {
    message: 'MCP server id must not contain "__"'
  })

/**
 * MCP server config. Legacy entries without `transport` default to stdio.
 * stdio requires `command`; http/sse require `url`.
 */
export const McpServerSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const obj = { ...(raw as Record<string, unknown>) }
    if (obj.transport === undefined || obj.transport === null || obj.transport === '') {
      obj.transport = 'stdio'
    }
    return obj
  },
  z
    .object({
      id: McpServerIdSchema,
      name: z.string().min(1),
      transport: McpTransportSchema.default('stdio'),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      url: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      /**
       * When non-empty, only these bare MCP tool names are exposed/invokable.
       * Empty / omitted = all tools (minus deniedTools).
       */
      allowedTools: z.array(z.string().min(1)).optional(),
      /** Bare MCP tool names that are never exposed or invokable. */
      deniedTools: z.array(z.string().min(1)).optional(),
      enabled: z.boolean().default(true),
      source: z.enum(['manual', 'marketplace']).optional(),
      packageId: z.string().optional(),
      packageVersion: z.string().optional()
    })
    .superRefine((val, ctx) => {
      if (val.transport === 'stdio' && !(val.command ?? '').trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'command is required for stdio transport',
          path: ['command']
        })
      }
      if ((val.transport === 'http' || val.transport === 'sse') && !(val.url ?? '').trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'url is required for http/sse transport',
          path: ['url']
        })
      }
    })
)
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

/**
 * Soft gate when the model stops with no tool calls in Agent mode.
 * `off` — never nudge. `notice` — one soft verify reminder. `require` — one reminder
 * after an external typecheck when the run lacks diagnostics evidence.
 */
export const VerifyBeforeDoneModeSchema = z.enum(['off', 'notice', 'require'])
export type VerifyBeforeDoneMode = z.infer<typeof VerifyBeforeDoneModeSchema>

export const TerminalShellSchema = z.enum(['auto', 'cmd', 'powershell', 'bash'])
export type TerminalShell = z.infer<typeof TerminalShellSchema>

/** Composer interaction mode: Ask (read-only), Plan (plan artifacts), Agent (full). */
export const AgentInteractionModeSchema = z.enum(['ask', 'plan', 'agent'])
export type AgentInteractionMode = z.infer<typeof AgentInteractionModeSchema>

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
  toolApproval: ToolApprovalSettingsSchema.default(DEFAULT_TOOL_APPROVAL),
  /** Shell used by the terminal tool. `auto` prefers PowerShell on Windows when available. */
  terminalShell: TerminalShellSchema.default('auto'),
  /**
   * Optional override for the diagnostics tool typecheck command.
   * Empty = auto-detect from package.json scripts / tsc.
   */
  diagnosticsCommand: z.string().default(''),
  /**
   * Soft verify-before-done gate in Agent mode (at most one continue).
   * Default `notice` — nudge once when finishing without diagnostics evidence.
   */
  verifyBeforeDone: VerifyBeforeDoneModeSchema.default('notice'),
  /** When set, sub-agents use this provider instead of `provider`. */
  subagentProvider: ProviderIdSchema.optional(),
  /** When set, sub-agents use this model instead of `model`. */
  subagentModel: z.string().min(1).optional(),
  marketplace: MarketplaceSettingsSchema.default(DEFAULT_MARKETPLACE_SETTINGS)
})
export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  provider: 'ollama',
  model: 'qwen2.5',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
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
  toolApproval: DEFAULT_TOOL_APPROVAL,
  terminalShell: 'auto',
  diagnosticsCommand: '',
  verifyBeforeDone: 'notice',
  marketplace: DEFAULT_MARKETPLACE_SETTINGS
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
