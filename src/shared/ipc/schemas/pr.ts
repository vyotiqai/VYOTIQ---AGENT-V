import { z } from 'zod'

export const PrMergeMethodSchema = z.enum(['squash', 'merge', 'rebase'])
export type PrMergeMethod = z.infer<typeof PrMergeMethodSchema>

export const PrFileSchema = z.object({
  path: z.string(),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0)
})

export const PrCommitSchema = z.object({
  oid: z.string(),
  messageHeadline: z.string(),
  authors: z.array(z.string())
})

export const PrCheckSchema = z.object({
  name: z.string(),
  state: z.string(),
  conclusion: z.string().nullable()
})

export const PrViewSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  body: z.string(),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  files: z.array(PrFileSchema),
  commits: z.array(PrCommitSchema),
  checks: z.array(PrCheckSchema)
})
export type PrView = z.infer<typeof PrViewSchema>

export const PrViewRequestSchema = z.object({
  workspacePath: z.string().min(1)
})

export const PrMergeRequestSchema = z.object({
  workspacePath: z.string().min(1),
  method: PrMergeMethodSchema
})

export const PrMergeResultSchema = z.object({
  detail: z.string()
})
export type PrMergeResult = z.infer<typeof PrMergeResultSchema>
