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
 * Per-file added/removed against HEAD.
 *
 * Renames are disabled so every entry is a plain path; a rename shows up as a
 * delete plus an add, which is what the change list wants to display anyway.
 */
async function trackedChanges(cwd: string, hasCommits: boolean): Promise<Map<string, GitChangedFile>> {
  const out = new Map<string, GitChangedFile>()
  const args = hasCommits
    ? ['diff', '--numstat', '--no-renames', '-z', 'HEAD']
    : ['diff', '--numstat', '--no-renames', '-z', '--cached']
  const stdout = await gitQuiet(args, cwd, READ_TIMEOUT_MS)
  if (!stdout) return out

  for (const record of splitNul(stdout)) {
    const parts = record.split('\t')
    if (parts.length < 3) continue
    const [addedRaw, removedRaw, path] = parts as [string, string, string]
    // Binary files report "-" for both counts; there is no line delta to show.
    const added = addedRaw === '-' ? 0 : Number(addedRaw)
    const removed = removedRaw === '-' ? 0 : Number(removedRaw)
    out.set(path, {
      path,
      status: 'modified',
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

export async function readGitStatus(cwd: string): Promise<GitStatus | null> {
  if (!isGitRepo(cwd)) return null

  const branchRaw = await gitQuiet(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, READ_TIMEOUT_MS)
  const branch = branchRaw?.trim() || null
  const hasCommits = (await gitQuiet(['rev-parse', '--verify', 'HEAD'], cwd, READ_TIMEOUT_MS)) != null

  const tracked = await trackedChanges(cwd, hasCommits)

  const porcelain = await gitQuiet(
    ['status', '--porcelain=v1', '-z', '-uall'],
    cwd,
    READ_TIMEOUT_MS
  )
  if (porcelain != null) {
    for (const record of splitNul(porcelain)) {
      // "XY <path>": two status columns, a space, then the path.
      const code = record.slice(0, 2)
      const path = record.slice(3)
      if (!path) continue

      if (code === '??') {
        const added = countFileLines(cwd, path)
        tracked.set(path, { path, status: 'untracked', added, removed: 0, binary: false })
        continue
      }
      const existing = tracked.get(path)
      if (existing) existing.status = statusFor(code)
      else tracked.set(path, { path, status: statusFor(code), added: 0, removed: 0, binary: false })
    }
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
}

/** Unified diff against HEAD (or staged index). Capped for tool output. */
export async function readGitDiff(
  cwd: string,
  opts: GitDiffOptions = {}
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  if (!isGitRepo(cwd)) return { ok: false, error: 'Not a git repository' }

  const args = ['diff', '--no-color', '--no-ext-diff']
  if (opts.staged) args.push('--cached')
  if (opts.path?.trim()) {
    args.push('--', opts.path.trim())
  }

  try {
    const stdout = await git(args, cwd, READ_TIMEOUT_MS)
    const text = stdout.trimEnd()
    if (!text) {
      return { ok: true, content: opts.staged ? '(no staged changes)' : '(no unstaged changes)' }
    }
    if (text.length <= DIFF_CAP_CHARS) return { ok: true, content: text }
    return {
      ok: true,
      content: text.slice(0, DIFF_CAP_CHARS) + `\n… (diff truncated at ${DIFF_CAP_CHARS} chars)`
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

export type CommitOutcome = { committed: boolean; pushed: boolean; detail: string }

export async function commitAll(
  cwd: string,
  message: string,
  push: boolean
): Promise<CommitOutcome> {
  if (!isGitRepo(cwd)) throw new Error('Not a git repository')

  await git(['add', '-A'], cwd, WRITE_TIMEOUT_MS)

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
