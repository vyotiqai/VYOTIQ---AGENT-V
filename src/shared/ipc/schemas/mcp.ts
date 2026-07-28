import { z } from 'zod'

export const McpServerStatusSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  connected: z.boolean(),
  toolCount: z.number().int().min(0),
  /** True when a Bearer token is stored in OS secure storage for this server. */
  hasAuthToken: z.boolean().optional(),
  error: z.string().optional()
})
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>

export const McpStatusResultSchema = z.object({
  servers: z.array(McpServerStatusSchema)
})
export type McpStatusResult = z.infer<typeof McpStatusResultSchema>
