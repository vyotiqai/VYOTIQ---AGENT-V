import { z } from 'zod'

export const AgentBrowserStateSchema = z.object({
  open: z.boolean(),
  url: z.string(),
  title: z.string(),
  snapshotDataUrl: z.string().nullable().optional(),
  navigating: z.boolean().optional()
})
export type AgentBrowserState = z.infer<typeof AgentBrowserStateSchema>
