import { readdir, readFile, stat } from 'fs/promises'
import { existsSync, statSync, type Dirent } from 'fs'
import { join, relative, sep } from 'path'

/**
 * Project instruction files, read in precedence order. A workspace that ships
 * conventions in AGENTS.md expects the agent to follow them without being told
 * in every prompt, so they belong in the system prompt rather than the history.
 */
const ROOT_FILES = ['AGENTS.md', 'CLAUDE.md']
const RULE_DIRS = [
  { dir: join('.cursor', 'rules'), extensions: ['.md', '.mdc'] },
  { dir: join('.vyotiq', 'rules'), extensions: ['.md'] }
]

const CACHE_TTL_MS = 30_000
/** A single runaway rules file should not evict the harness from the prompt. */
const MAX_FILE_BYTES = 64 * 1024
const MAX_RULE_FILES = 24
const MAX_DIR_DEPTH = 3

export type RuleFile = { path: string; content: string }

type CacheEntry = { fingerprint: string; files: RuleFile[]; builtAt: number }

const cache = new Map<string, CacheEntry>()

export function clearRulesCache(workspacePath?: string): void {
  if (workspacePath) cache.delete(workspacePath)
  else cache.clear()
}

function fingerprintFor(workspacePath: string): string {
  const parts: string[] = []
  for (const name of ROOT_FILES) {
    const p = join(workspacePath, name)
    try {
      parts.push(existsSync(p) ? `${name}:${statSync(p).mtimeMs}` : `${name}:-`)
    } catch {
      parts.push(`${name}:?`)
    }
  }
  for (const { dir } of RULE_DIRS) {
    const p = join(workspacePath, dir)
    try {
      parts.push(existsSync(p) ? `${dir}:${statSync(p).mtimeMs}` : `${dir}:-`)
    } catch {
      parts.push(`${dir}:?`)
    }
  }
  return parts.join('|')
}

async function readCapped(filePath: string): Promise<string | null> {
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size === 0) return null
    const text = await readFile(filePath, 'utf8')
    if (text.length <= MAX_FILE_BYTES) return text.trim() || null
    return `${text.slice(0, MAX_FILE_BYTES).trim()}\n… (truncated)`
  } catch {
    return null
  }
}

async function collectFromDir(
  workspacePath: string,
  dirPath: string,
  extensions: string[],
  depth: number,
  out: RuleFile[]
): Promise<void> {
  if (depth > MAX_DIR_DEPTH || out.length >= MAX_RULE_FILES) return
  let entries: Dirent[]
  try {
    entries = await readdir(dirPath, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }
  // Stable order so the prompt does not churn between runs on the same workspace.
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of sorted) {
    if (out.length >= MAX_RULE_FILES) return
    const full = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      await collectFromDir(workspacePath, full, extensions, depth + 1, out)
      continue
    }
    if (!extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) continue
    const content = await readCapped(full)
    if (content) {
      out.push({ path: relative(workspacePath, full).split(sep).join('/'), content })
    }
  }
}

/** Read every workspace instruction file, in precedence order. */
export async function readWorkspaceRules(workspacePath: string | null): Promise<RuleFile[]> {
  if (!workspacePath) return []

  const fingerprint = fingerprintFor(workspacePath)
  const cached = cache.get(workspacePath)
  if (cached && cached.fingerprint === fingerprint && Date.now() - cached.builtAt < CACHE_TTL_MS) {
    return cached.files
  }

  const files: RuleFile[] = []
  for (const name of ROOT_FILES) {
    const content = await readCapped(join(workspacePath, name))
    if (content) files.push({ path: name, content })
  }
  for (const { dir, extensions } of RULE_DIRS) {
    await collectFromDir(workspacePath, join(workspacePath, dir), extensions, 0, files)
  }

  cache.set(workspacePath, { fingerprint, files, builtAt: Date.now() })
  return files
}

/**
 * Render the rules as a system-prompt section. Each file keeps its path as a
 * header so the model can cite where an instruction came from.
 */
export function formatWorkspaceRules(files: RuleFile[]): string {
  if (!files.length) return ''
  const body = files
    .map((file) => `### ${file.path}\n${file.content}`)
    .join('\n\n')
  return [
    '## Workspace rules',
    'Project-authored instructions. Follow them unless the user overrides them in this conversation.',
    '',
    body
  ].join('\n')
}

export async function buildWorkspaceRulesSection(
  workspacePath: string | null
): Promise<string> {
  return formatWorkspaceRules(await readWorkspaceRules(workspacePath))
}
