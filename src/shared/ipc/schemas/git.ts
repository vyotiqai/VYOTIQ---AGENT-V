import { z } from 'zod'

export const GitChangedFileSchema = z.object({
  path: z.string(),
  status: z.enum(['modified', 'added', 'deleted', 'untracked']),
  /** Combined line deltas (staged + unstaged). */
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
  /** Index-side line deltas vs HEAD. */
  addedStaged: z.number().int().min(0),
  removedStaged: z.number().int().min(0),
  /** Worktree-side line deltas vs index (untracked counts as unstaged). */
  addedUnstaged: z.number().int().min(0),
  removedUnstaged: z.number().int().min(0),
  /** No line counts exist for binary files; only the fact that they changed. */
  binary: z.boolean(),
  /** Index (staged) side has a change — from porcelain XY. */
  staged: z.boolean(),
  /** Worktree side has a change — from porcelain XY. */
  unstaged: z.boolean()
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
  push: z.boolean().optional(),
  /**
   * `all` stages the whole working tree then commits (Uncommitted).
   * `staged` commits the index only — no `git add -A` (Staged scope).
   */
  mode: z.enum(['all', 'staged']).optional().default('all')
})

export const GitCommitResultSchema = z.object({
  committed: z.boolean(),
  pushed: z.boolean(),
  detail: z.string()
})
export type GitCommitResult = z.infer<typeof GitCommitResultSchema>

export const GitStageAllRequestSchema = z.object({
  workspacePath: z.string().min(1)
})

export const GitStageAllResultSchema = z.object({
  staged: z.boolean(),
  detail: z.string()
})
export type GitStageAllResult = z.infer<typeof GitStageAllResultSchema>

export const GitDiffRequestSchema = z.object({
  workspacePath: z.string().min(1),
  path: z.string().optional(),
  staged: z.boolean().optional(),
  /** Ignore whitespace when computing the diff (`git diff -w`). */
  ignoreWhitespace: z.boolean().optional(),
  /** When set, show the patch introduced by this commit (`git show`). */
  sha: z.string().min(1).optional()
})
export type GitDiffRequest = z.infer<typeof GitDiffRequestSchema>

export const GitDiffResultSchema = z.object({
  content: z.string()
})
export type GitDiffResult = z.infer<typeof GitDiffResultSchema>

export const GitLogEntrySchema = z.object({
  sha: z.string().min(1),
  shortSha: z.string().min(1),
  subject: z.string(),
  author: z.string(),
  relativeDate: z.string()
})
export type GitLogEntry = z.infer<typeof GitLogEntrySchema>

export const GitLogRequestSchema = z.object({
  workspacePath: z.string().min(1),
  limit: z.number().int().positive().max(100).optional()
})

export const GitLogResultSchema = z.array(GitLogEntrySchema)
export type GitLogResult = z.infer<typeof GitLogResultSchema>

export const GitCommitFilesRequestSchema = z.object({
  workspacePath: z.string().min(1),
  sha: z.string().min(1)
})

export const GitCommitFilesResultSchema = z.object({
  files: z.array(GitChangedFileSchema)
})
export type GitCommitFilesResult = z.infer<typeof GitCommitFilesResultSchema>
