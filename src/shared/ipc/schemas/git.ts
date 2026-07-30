import { z } from 'zod'

export const GitChangedFileSchema = z.object({
  path: z.string(),
  status: z.enum(['modified', 'added', 'deleted', 'untracked']),
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
  /** No line counts exist for binary files; only the fact that they changed. */
  binary: z.boolean()
})
export type GitChangedFile = z.infer<typeof GitChangedFileSchema>

export const GitStatusSchema = z.object({
  /** Null when the branch cannot be named, e.g. a detached HEAD. */
  branch: z.string().nullable(),
  files: z.array(GitChangedFileSchema),
  /** The file list is capped; totals below still cover every change. */
  truncated: z.boolean(),
  fileCount: z.number().int().min(0),
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
  hasRemote: z.boolean(),
  hasCommits: z.boolean()
})
export type GitStatus = z.infer<typeof GitStatusSchema>

export const GitStatusRequestSchema = z.object({
  workspacePath: z.string().min(1)
})

/** Null means the workspace simply is not a git repository. */
export const GitStatusResultSchema = GitStatusSchema.nullable()

export const GitCommitRequestSchema = z.object({
  workspacePath: z.string().min(1),
  message: z.string().min(1).max(2000),
  push: z.boolean().optional()
})

export const GitCommitResultSchema = z.object({
  committed: z.boolean(),
  pushed: z.boolean(),
  detail: z.string()
})
export type GitCommitResult = z.infer<typeof GitCommitResultSchema>

export const GitDiffRequestSchema = z.object({
  workspacePath: z.string().min(1),
  path: z.string().optional(),
  staged: z.boolean().optional()
})
export type GitDiffRequest = z.infer<typeof GitDiffRequestSchema>

export const GitDiffResultSchema = z.object({
  content: z.string()
})
export type GitDiffResult = z.infer<typeof GitDiffResultSchema>
