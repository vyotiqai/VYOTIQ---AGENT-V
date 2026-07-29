import { z } from 'zod'

export const AgentBrowserTabSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  active: z.boolean()
})

export const AgentBrowserStateSchema = z.object({
  open: z.boolean(),
  url: z.string(),
  title: z.string(),
  snapshotDataUrl: z.string().nullable().optional(),
  navigating: z.boolean().optional(),
  tabs: z.array(AgentBrowserTabSchema).optional(),
  canGoBack: z.boolean().optional(),
  canGoForward: z.boolean().optional()
})
export type AgentBrowserState = z.infer<typeof AgentBrowserStateSchema>
export type AgentBrowserTab = z.infer<typeof AgentBrowserTabSchema>
