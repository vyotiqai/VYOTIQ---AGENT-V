import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'

const execFile = promisify(execFileCb)

const TIMEOUT_MS = 30_000
const MERGE_TIMEOUT_MS = 120_000
const MAX_BUFFER = 4 * 1024 * 1024

const GH_ENV = {
  ...process.env,
  GH_PROMPT_DISABLED: '1',
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never'
}

export type PrFile = { path: string; additions: number; deletions: number }
export type PrCommit = { oid: string; messageHeadline: string; authors: string[] }
export type PrCheck = { name: string; state: string; conclusion: string | null }

export type PrView = {
  number: number
  title: string
  url: string
  state: string
  baseRefName: string
  headRefName: string
  body: string
  additions: number
  deletions: number
  files: PrFile[]
  commits: PrCommit[]
  checks: PrCheck[]
}

async function gh(args: string[], cwd: string, timeout = TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFile('gh', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    env: GH_ENV
  })
  return stdout
}

export async function ghAvailable(): Promise<boolean> {
  try {
    await execFile('gh', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env: GH_ENV
    })
    return true
  } catch {
    return false
  }
}

type GhPrJson = {
  number?: number
  title?: string
  url?: string
  state?: string
  baseRefName?: string
  headRefName?: string
  body?: string
  additions?: number
  deletions?: number
  files?: Array<{ path?: string; additions?: number; deletions?: number }>
  commits?: Array<{
    oid?: string
    messageHeadline?: string
    authors?: Array<{ name?: string; login?: string }>
  }>
  statusCheckRollup?: Array<{
    name?: string
    state?: string
    conclusion?: string | null
  }>
}

/** Current branch PR, or null when none / gh missing. */
export async function prView(cwd: string): Promise<PrView | null> {
  if (!(await ghAvailable())) return null
  try {
    const raw = await gh(
      [
        'pr',
        'view',
        '--json',
        'number,title,url,state,baseRefName,headRefName,body,additions,deletions,files,commits,statusCheckRollup'
      ],
      cwd
    )
    const data = JSON.parse(raw) as GhPrJson
    if (typeof data.number !== 'number') return null
    return {
      number: data.number,
      title: data.title ?? '',
      url: data.url ?? '',
      state: data.state ?? 'OPEN',
      baseRefName: data.baseRefName ?? '',
      headRefName: data.headRefName ?? '',
      body: data.body ?? '',
      additions: data.additions ?? 0,
      deletions: data.deletions ?? 0,
      files: (data.files ?? []).map((f) => ({
        path: f.path ?? '',
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0
      })),
      commits: (data.commits ?? []).map((c) => ({
        oid: c.oid ?? '',
        messageHeadline: c.messageHeadline ?? '',
        authors: (c.authors ?? [])
          .map((a) => a.name || a.login || '')
          .filter(Boolean)
      })),
      checks: (data.statusCheckRollup ?? []).map((c) => ({
        name: c.name ?? 'check',
        state: c.state ?? 'UNKNOWN',
        conclusion: c.conclusion ?? null
      }))
    }
  } catch {
    return null
  }
}

export async function prMerge(
  cwd: string,
  method: 'squash' | 'merge' | 'rebase'
): Promise<{ detail: string }> {
  if (!(await ghAvailable())) {
    throw new Error('GitHub CLI (gh) is not installed or not on PATH')
  }
  const flag =
    method === 'squash' ? '--squash' : method === 'rebase' ? '--rebase' : '--merge'
  try {
    const out = await gh(['pr', 'merge', flag, '--delete-branch=false'], cwd, MERGE_TIMEOUT_MS)
    return { detail: out.trim() || `Merged with ${method}` }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message)
  }
}
