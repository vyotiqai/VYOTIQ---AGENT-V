import type { UiToolRow } from '@shared/transcript'
import { parseArgsRecord } from '@shared/toolSummary'
import { countDiffLines, parseUnifiedDiff, type DiffLine } from './edit'

export type GitStatusFile = {
  status: string
  path: string
  added: number
  removed: number
}

export type GitStatusParsed = {
  branch: string
  clean: boolean
  message: string
  files: GitStatusFile[]
  added: number
  removed: number
}

export type GitDiffParsed = {
  path: string
  staged: boolean
  summary: string
  message: string
  lines: DiffLine[]
  added: number
  removed: number
}

/**
 * Parse git_status content from toolGitStatusAsync:
 *
 *   branch: main
 *   ...
 *   M          +2 -0  src/a.ts
 *   (clean)
 */
export function parseGitStatusData(tool: UiToolRow): GitStatusParsed {
  const content = (tool.content ?? '').trim()
  if (!content) {
    return { branch: '', clean: true, message: '', files: [], added: 0, removed: 0 }
  }
  if (content === 'Not a git repository') {
    return {
      branch: '',
      clean: true,
      message: content,
      files: [],
      added: 0,
      removed: 0
    }
  }

  let branch = ''
  let added = 0
  let removed = 0
  const files: GitStatusFile[] = []
  let clean = false

  for (const raw of content.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('branch:')) {
      branch = line.slice('branch:'.length).trim()
      continue
    }
    if (line === '(clean)') {
      clean = true
      continue
    }
    const totals = line.match(/^\+(\d+)\s+-(\d+)$/)
    if (totals) {
      added = Number(totals[1])
      removed = Number(totals[2])
      continue
    }
    const file = line.match(/^(\S+)\s+\+(\d+)\s+-(\d+)\s+(.+)$/)
    if (file) {
      files.push({
        status: file[1]!,
        added: Number(file[2]),
        removed: Number(file[3]),
        path: file[4]!.trim()
      })
    }
  }

  return {
    branch,
    clean: clean || files.length === 0,
    message: '',
    files,
    added,
    removed
  }
}

/** Parse git_diff tool row: unified diff in content + path/staged from args. */
export function parseGitDiffData(tool: UiToolRow): GitDiffParsed {
  const args = parseArgsRecord(tool.argsPreview)
  const path = typeof args?.path === 'string' ? args.path : ''
  const staged = args?.staged === true
  const content = tool.content ?? ''
  const summary = tool.summary?.trim() || (path ? `git diff ${path}` : staged ? 'git diff --staged' : 'git diff')

  if (!content.trim() || content === 'Not a git repository') {
    return {
      path,
      staged,
      summary,
      message: content.trim() || 'No diff',
      lines: [],
      added: 0,
      removed: 0
    }
  }

  const lines = parseUnifiedDiff(content)
  const { added, removed } = countDiffLines(content)
  return {
    path,
    staged,
    summary,
    message: lines.length === 0 ? content : '',
    lines,
    added,
    removed
  }
}
