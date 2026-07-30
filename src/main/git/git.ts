import { execFile as execFileCb } from 'child_process'
import { existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import type { GitChangedFile, GitStatus } from '../../shared/ipc'

const execFile = promisify(execFileCb)

const READ_TIMEOUT_MS = 5000
const WRITE_TIMEOUT_MS = 20_000
const PUSH_TIMEOUT_MS = 120_000
const MAX_BUFFER = 4 * 1024 * 1024

/** Beyond this the list stops being a summary and starts being a file tree. */
const MAX_FILES = 200
/** Counting lines means reading the file, so only do it for plausible source. */
const UNTRACKED_LINE_COUNT_MAX_BYTES = 512 * 1024

/**
 * Git never runs interactively here. A credential or editor prompt in a process
 * with no terminal would hang until the timeout instead of failing cleanly.
 */
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GCM_INTERACTIVE: 'never'
}

export function isGitRepo(cwd: string): boolean {
  return existsSync(join(cwd, '.git'))
}

async function git(args: string[], cwd: string, timeout: number): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    env: GIT_ENV
  })
  return stdout
}

async function gitQuiet(args: string[], cwd: string, timeout: number): Promise<string | null> {
  try {
    return await git(args, cwd, timeout)
  } catch {
    return null
  }
}

/** Split NUL-delimited git output, dropping the trailing empty field. */
function splitNul(out: string): string[] {
  return out.split('\0').filter((part) => part.length > 0)
}

function countFileLines(cwd: string, relPath: string): number {
  try {
    const full = join(cwd, relPath)
    const stat = statSync(full)
    if (!stat.isFile() || stat.size > UNTRACKED_LINE_COUNT_MAX_BYTES) return 0
    const text = readFileSync(full, 'utf8')
    if (!text) return 0
    const lines = text.split('\n')
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    return lines.length
  } catch {
    return 0
  }
}

/**
 * Parse `git diff --numstat -z` into path → line deltas.
 */
async function numstatMap(cwd: string, args: string[]): Promise<Map<string, {
  added: number
  removed: number
  binary: boolean
}>> {
  const out = new Map<string, { added: number; removed: number; binary: boolean }>()
  const stdout = await gitQuiet(args, cwd, READ_TIMEOUT_MS)
  if (!stdout) return out
  for (const record of splitNul(stdout)) {
    const parts = record.split('\t')
    if (parts.length < 3) continue
    const [addedRaw, removedRaw, path] = parts as [string, string, string]
    const added = addedRaw === '-' ? 0 : Number(addedRaw)
    const removed = removedRaw === '-' ? 0 : Number(removedRaw)
    out.set(path, {
      added: Number.isFinite(added) ? added : 0,
      removed: Number.isFinite(removed) ? removed : 0,
      binary: addedRaw === '-'
    })
  }
  return out
}

function statusFor(code: string): GitChangedFile['status'] {
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  return 'modified'
}

/** Map porcelain XY columns to staged / unstaged sides. */
function flagsFromPorcelain(code: string): { staged: boolean; unstaged: boolean } {
  if (code === '??' || code === '!!') {
    return { staged: false, unstaged: true }
  }
  const x = code[0] ?? ' '
  const y = code[1] ?? ' '
  if (
    x === 'U' ||
    y === 'U' ||
    code === 'DD' ||
    code === 'AU' ||
    code === 'UD' ||
    code === 'UA' ||
    code === 'DU' ||
    code === 'AA'
  ) {
    return { staged: true, unstaged: true }
  }
  return { staged: x !== ' ', unstaged: y !== ' ' }
}

function emptyFile(path: string, status: GitChangedFile['status']): GitChangedFile {
  return {
    path,
    status,
    added: 0,
    removed: 0,
    addedStaged: 0,
    removedStaged: 0,
    addedUnstaged: 0,
    removedUnstaged: 0,
    binary: false,
    staged: false,
    unstaged: false
  }
}

export async function readGitStatus(cwd: string): Promise<GitStatus | null> {
  if (!isGitRepo(cwd)) return null

  const branchRaw = await gitQuiet(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, READ_TIMEOUT_MS)
  const branch = branchRaw?.trim() || null
  const hasCommits = (await gitQuiet(['rev-parse', '--verify', 'HEAD'], cwd, READ_TIMEOUT_MS)) != null

  const stagedArgs = hasCommits
    ? ['diff', '--numstat', '--no-renames', '-z', '--cached', 'HEAD']
    : ['diff', '--numstat', '--no-renames', '-z', '--cached']
  const unstagedArgs = ['diff', '--numstat', '--no-renames', '-z']
  const [stagedMap, unstagedMap] = await Promise.all([
    numstatMap(cwd, stagedArgs),
    numstatMap(cwd, unstagedArgs)
  ])

  const tracked = new Map<string, GitChangedFile>()
  const ensure = (path: string, status: GitChangedFile['status'] = 'modified'): GitChangedFile => {
    let file = tracked.get(path)
    if (!file) {
      file = emptyFile(path, status)
      tracked.set(path, file)
    }
    return file
  }

  for (const [path, delta] of stagedMap) {
    const file = ensure(path)
    file.addedStaged = delta.added
    file.removedStaged = delta.removed
    file.binary = file.binary || delta.binary
  }
  for (const [path, delta] of unstagedMap) {
    const file = ensure(path)
    file.addedUnstaged = delta.added
    file.removedUnstaged = delta.removed
    file.binary = file.binary || delta.binary
  }

  const porcelain = await gitQuiet(
    ['status', '--porcelain=v1', '-z', '-uall'],
    cwd,
    READ_TIMEOUT_MS
  )
  if (porcelain != null) {
    for (const record of splitNul(porcelain)) {
      const code = record.slice(0, 2)
      const path = record.slice(3)
      if (!path) continue
      const flags = flagsFromPorcelain(code)

      if (code === '??') {
        const added = countFileLines(cwd, path)
        tracked.set(path, {
          ...emptyFile(path, 'untracked'),
          added,
          addedUnstaged: added,
          binary: false,
          ...flags
        })
        continue
      }
      const existing = ensure(path, statusFor(code))
      existing.status = statusFor(code)
      existing.staged = flags.staged
      existing.unstaged = flags.unstaged
    }
  }

  for (const file of tracked.values()) {
    // Porcelain may mark staged/unstaged even when numstat is empty (mode-only).
    if (!file.staged && (file.addedStaged > 0 || file.removedStaged > 0)) file.staged = true
    if (!file.unstaged && (file.addedUnstaged > 0 || file.removedUnstaged > 0)) file.unstaged = true
    file.added = file.addedStaged + file.addedUnstaged
    file.removed = file.removedStaged + file.removedUnstaged
  }

  const all = [...tracked.values()].sort((a, b) => a.path.localeCompare(b.path))
  const files = all.slice(0, MAX_FILES)

  let added = 0
  let removed = 0
  for (const file of all) {
    added += file.added
    removed += file.removed
  }

  const remote = await gitQuiet(['remote'], cwd, READ_TIMEOUT_MS)

  return {
    branch,
    files,
    truncated: all.length > files.length,
    fileCount: all.length,
    added,
    removed,
    hasRemote: Boolean(remote?.trim()),
    hasCommits
  }
}

const DIFF_CAP_CHARS = 100_000

export type GitDiffOptions = {
  path?: string
  staged?: boolean
  ignoreWhitespace?: boolean
  sha?: string
}

function capDiff(text: string): string {
  if (text.length <= DIFF_CAP_CHARS) return text
  return text.slice(0, DIFF_CAP_CHARS) + `\n… (diff truncated at ${DIFF_CAP_CHARS} chars)`
}

/** Unified diff against HEAD (or staged index / commit). Capped for tool output. */
export async function readGitDiff(
  cwd: string,
  opts: GitDiffOptions = {}
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  if (!isGitRepo(cwd)) return { ok: false, error: 'Not a git repository' }

  const sha = opts.sha?.trim()
  if (sha) {
    const args = ['show', '--no-color', '--no-ext-diff', '--format=']
    if (opts.ignoreWhitespace) args.push('-w')
    args.push(sha)
    if (opts.path?.trim()) {
      args.push('--', opts.path.trim())
    }
    try {
      const stdout = await git(args, cwd, READ_TIMEOUT_MS)
      const text = stdout.trimEnd()
      if (!text) return { ok: true, content: '(no changes in commit)' }
      return { ok: true, content: capDiff(text) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  }

  const hasCommits =
    (await gitQuiet(['rev-parse', '--verify', 'HEAD'], cwd, READ_TIMEOUT_MS)) != null
  const args = ['diff', '--no-color', '--no-ext-diff']
  if (opts.ignoreWhitespace) args.push('-w')
  if (opts.staged || !hasCommits) args.push('--cached')
  if (opts.path?.trim()) {
    args.push('--', opts.path.trim())
  }

  try {
    const stdout = await git(args, cwd, READ_TIMEOUT_MS)
    const text = stdout.trimEnd()
    if (!text) {
      return {
        ok: true,
        content: opts.staged || !hasCommits ? '(no staged changes)' : '(no unstaged changes)'
      }
    }
    return { ok: true, content: capDiff(text) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

export type GitLogEntry = {
  sha: string
  shortSha: string
  subject: string
  author: string
  relativeDate: string
}

/** Recent commits for the Changes → Commits scope. */
export async function readGitLog(cwd: string, limit = 40): Promise<GitLogEntry[]> {
  if (!isGitRepo(cwd)) return []
  const capped = Math.min(Math.max(1, limit), 100)
  const stdout = await gitQuiet(
    ['log', `-n${capped}`, '--format=%H%x09%h%x09%s%x09%an%x09%cr'],
    cwd,
    READ_TIMEOUT_MS
  )
  if (!stdout?.trim()) return []
  const out: GitLogEntry[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const [sha, shortSha, subject, author, relativeDate] = line.split('\t')
    if (!sha || !shortSha) continue
    out.push({
      sha,
      shortSha,
      subject: subject ?? '',
      author: author ?? '',
      relativeDate: relativeDate ?? ''
    })
  }
  return out
}

/** Files changed in a single commit (numstat). */
export async function readGitCommitFiles(cwd: string, sha: string): Promise<GitChangedFile[]> {
  if (!isGitRepo(cwd)) return []
  const stdout = await gitQuiet(
    ['show', '--numstat', '--format=', '--no-renames', sha.trim()],
    cwd,
    READ_TIMEOUT_MS
  )
  if (!stdout?.trim()) return []
  const out: GitChangedFile[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [addedRaw, removedRaw, path] = parts as [string, string, string]
    const added = addedRaw === '-' ? 0 : Number(addedRaw)
    const removed = removedRaw === '-' ? 0 : Number(removedRaw)
    const binary = addedRaw === '-'
    let status: GitChangedFile['status'] = 'modified'
    if (!binary && added > 0 && removed === 0) status = 'added'
    if (!binary && added === 0 && removed > 0) status = 'deleted'
    out.push({
      path,
      status,
      added: Number.isFinite(added) ? added : 0,
      removed: Number.isFinite(removed) ? removed : 0,
      addedStaged: 0,
      removedStaged: 0,
      addedUnstaged: Number.isFinite(added) ? added : 0,
      removedUnstaged: Number.isFinite(removed) ? removed : 0,
      binary,
      staged: false,
      unstaged: false
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export type CommitOutcome = { committed: boolean; pushed: boolean; detail: string }
export type CommitMode = 'all' | 'staged'

export async function commitAll(
  cwd: string,
  message: string,
  push: boolean,
  mode: CommitMode = 'all'
): Promise<CommitOutcome> {
  if (!isGitRepo(cwd)) throw new Error('Not a git repository')

  if (mode === 'all') {
    await git(['add', '-A'], cwd, WRITE_TIMEOUT_MS)
  }

  const staged = await gitQuiet(['diff', '--cached', '--name-only'], cwd, READ_TIMEOUT_MS)
  if (!staged?.trim()) {
    return { committed: false, pushed: false, detail: 'Nothing to commit' }
  }

  await git(['commit', '-m', message], cwd, WRITE_TIMEOUT_MS)
  if (!push) return { committed: true, pushed: false, detail: 'Committed' }

  const remote = await gitQuiet(['remote'], cwd, READ_TIMEOUT_MS)
  if (!remote?.trim()) {
    return { committed: true, pushed: false, detail: 'Committed. No remote to push to.' }
  }

  // A first push on a fresh branch has no upstream, so set one rather than fail.
  const branch = (await gitQuiet(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, READ_TIMEOUT_MS))?.trim()
  const pushArgs =
    branch && branch !== 'HEAD' ? ['push', '--set-upstream', 'origin', branch] : ['push']
  await git(pushArgs, cwd, PUSH_TIMEOUT_MS)
  return { committed: true, pushed: true, detail: 'Committed and pushed' }
}

/** Stage every unstaged / untracked path (`git add -A`). */
export async function stageAll(cwd: string): Promise<{ staged: boolean; detail: string }> {
  if (!isGitRepo(cwd)) throw new Error('Not a git repository')
  const before = await gitQuiet(['status', '--porcelain=v1', '-z', '-uall'], cwd, READ_TIMEOUT_MS)
  if (!before?.trim()) {
    return { staged: false, detail: 'Nothing to stage' }
  }
  await git(['add', '-A'], cwd, WRITE_TIMEOUT_MS)
  return { staged: true, detail: 'Staged all changes' }
}
