import { z } from 'zod'

export const MarketplaceKindSchema = z.enum(['mcp', 'skill', 'plugin'])
export type MarketplaceKind = z.infer<typeof MarketplaceKindSchema>

export const MarketplaceInstallSourceSchema = z.enum([
  'registry',
  'path',
  'zip',
  'git',
  'npm',
  'bundled',
  /** Install HTTP/SSE MCP by endpoint URL (materializes a marketplace package). */
  'remote'
])
export type MarketplaceInstallSource = z.infer<typeof MarketplaceInstallSourceSchema>

export const McpTransportSchema = z.enum(['stdio', 'http', 'sse'])
export type McpTransport = z.infer<typeof McpTransportSchema>

/** Manifest for a Vyotiq-native MCP package (`vyotiq.mcp.json`). */
export const VyotiqMcpManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('mcp'),
    id: z
      .string()
      .min(1)
      .refine((id) => !id.includes('__'), { message: 'id must not contain "__"' }),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().default(''),
    transport: McpTransportSchema.default('stdio'),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    /** Optional default allow list (bare tool names) when installed. */
    allowedTools: z.array(z.string().min(1)).optional(),
    /** Optional default deny list (bare tool names) when installed. */
    deniedTools: z.array(z.string().min(1)).optional()
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
export type VyotiqMcpManifest = z.infer<typeof VyotiqMcpManifestSchema>

/** Frontmatter fields for `skill.md` (Vyotiq-native). */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1).optional()
})
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

export const VyotiqPluginManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('plugin'),
  id: z
    .string()
    .min(1)
    .refine((id) => !id.includes('__'), { message: 'id must not contain "__"' }),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(''),
  mcp: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([])
})
export type VyotiqPluginManifest = z.infer<typeof VyotiqPluginManifestSchema>

export const MarketplaceCatalogSectionSchema = z.enum(['discover', 'featured'])
export type MarketplaceCatalogSection = z.infer<typeof MarketplaceCatalogSectionSchema>

export const MarketplaceContentsPreviewSchema = z.object({
  mcp: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1) }))
    .optional(),
  skills: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().default('')
      })
    )
    .optional(),
  rules: z.array(z.object({ path: z.string().min(1) })).optional()
})
export type MarketplaceContentsPreview = z.infer<typeof MarketplaceContentsPreviewSchema>

export const PackageContentsSchema = z.object({
  id: z.string().min(1),
  kind: MarketplaceKindSchema,
  mcp: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
      transport: McpTransportSchema.optional(),
      url: z.string().optional(),
      command: z.string().optional()
    })
  ),
  skills: z.array(
    z.object({ name: z.string(), description: z.string(), path: z.string() })
  ),
  rules: z.array(z.object({ path: z.string() }))
})
export type PackageContents = z.infer<typeof PackageContentsSchema>

export const MarketplaceCatalogEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(''),
  kind: MarketplaceKindSchema,
  downloadUrl: z.string().optional(),
  bundledPath: z.string().optional(),
  source: z.enum(['bundled', 'remote']).default('remote'),
  publisher: z.string().optional(),
  verified: z.boolean().optional(),
  sections: z.array(MarketplaceCatalogSectionSchema).optional(),
  /** Drives home category headings (e.g. infrastructure, skills, tools). */
  category: z.string().optional(),
  featuredRank: z.number().int().optional(),
  /** Relative path under resources/marketplace/ (e.g. icons/filesystem.svg). */
  iconPath: z.string().optional(),
  iconUrl: z.string().optional(),
  /** When false, UI shows Coming soon instead of Install. Default true. */
  installable: z.boolean().optional(),
  contentsPreview: MarketplaceContentsPreviewSchema.optional()
})
export type MarketplaceCatalogEntry = z.infer<typeof MarketplaceCatalogEntrySchema>

export const MarketplaceCatalogSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  packages: z.array(MarketplaceCatalogEntrySchema).default([])
})
export type MarketplaceCatalog = z.infer<typeof MarketplaceCatalogSchema>

export const MarketplaceInstalledItemSchema = z.object({
  id: z.string().min(1),
  kind: MarketplaceKindSchema,
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  installSource: MarketplaceInstallSourceSchema,
  installedAt: z.string().min(1),
  /** Relative path under marketplace/packages/{id}/{version} */
  packagePath: z.string().min(1)
})
export type MarketplaceInstalledItem = z.infer<typeof MarketplaceInstalledItemSchema>

export const MarketplaceInstallResultSchema = z.object({
  item: MarketplaceInstalledItemSchema,
  /** Present when a Bearer token was requested; false if secure storage failed. */
  authTokenStored: z.boolean().optional()
})
export type MarketplaceInstallResult = z.infer<typeof MarketplaceInstallResultSchema>

export const MarketplaceIndexSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(MarketplaceInstalledItemSchema).default([])
})
export type MarketplaceIndex = z.infer<typeof MarketplaceIndexSchema>

export const MarketplaceOverridesSchema = z.object({
  mcp: z.record(z.string(), z.boolean()).optional(),
  skills: z.record(z.string(), z.boolean()).optional(),
  plugins: z.record(z.string(), z.boolean()).optional()
})
export type MarketplaceOverrides = z.infer<typeof MarketplaceOverridesSchema>

export const MarketplaceSettingsSchema = z.object({
  registryUrl: z.string().default(''),
  remoteInstallAcked: z.boolean().default(false)
})
export type MarketplaceSettings = z.infer<typeof MarketplaceSettingsSchema>

export const DEFAULT_MARKETPLACE_SETTINGS: MarketplaceSettings = {
  registryUrl: '',
  remoteInstallAcked: false
}

export const MarketplaceInstallRequestSchema = z.object({
  source: MarketplaceInstallSourceSchema,
  /** Absolute folder / zip path, git URL, npm package name, catalog id, or remote MCP URL */
  target: z.string().min(1),
  version: z.string().optional(),
  kind: MarketplaceKindSchema.optional(),
  /** Display name when source is `remote` */
  name: z.string().min(1).optional(),
  /** http | sse when source is `remote` (default http) */
  transport: z.enum(['http', 'sse']).optional(),
  /** Optional Bearer token (stored in OS secure storage; never written into the package) */
  bearerToken: z.string().optional(),
  /** Extra non-secret headers (Authorization from bearerToken / safeStorage wins) */
  headers: z.record(z.string(), z.string()).optional()
})
export type MarketplaceInstallRequest = z.infer<typeof MarketplaceInstallRequestSchema>

export const MarketplaceSetEnabledRequestSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean()
})
export type MarketplaceSetEnabledRequest = z.infer<typeof MarketplaceSetEnabledRequestSchema>

export const MarketplaceUninstallRequestSchema = z.object({
  id: z.string().min(1)
})
export type MarketplaceUninstallRequest = z.infer<typeof MarketplaceUninstallRequestSchema>

export const MarketplaceBrowseRequestSchema = z.object({
  kind: MarketplaceKindSchema.optional(),
  q: z.string().optional()
})
export type MarketplaceBrowseRequest = z.infer<typeof MarketplaceBrowseRequestSchema>
