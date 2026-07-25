import { assertInsideWorkspace } from '../../../shared/workspacePath'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, extname } from 'path'
import { gitignoreMatcherForDir } from './gitignore'

const IGNORE = new Set([
  'node_modules',
  '.git',
  '.vyotiq',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.turbo'
])

const TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.css',
  '.scss',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.rs',
  '.go',
  '.py',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.sh',
  '.ps1',
  '.sql',
  '.vue',
  '.svelte'
])

/** Yield the event loop so long scans stay responsive to abort/cancel. */
const YIELD_EVERY_DIRS = 64
const YIELD_EVERY_FILES = 32

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

async function collectFiles(
  workspaceRoot: string,
  cap: number,
  signal?: AbortSignal
): Promise<string[]> {
  const files: string[] = []
  const queue: Array<{ dir: string; relDir: string }> = [{ dir: workspaceRoot, relDir: '' }]
  let scanned = 0

  while (queue.length > 0) {
    throwIfAborted(signal)
    if (files.length >= cap) break

    const next = queue.shift()!
    scanned += 1
    if (scanned > 1 && scanned % YIELD_EVERY_DIRS === 0) {
      await yieldToEventLoop()
      throwIfAborted(signal)
    }

    const dirMatcher = gitignoreMatcherForDir(workspaceRoot, next.relDir)
    let entries
    try {
      entries = readdirSync(next.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      throwIfAborted(signal)
      if (files.length >= cap) break
      if (IGNORE.has(entry.name)) continue
      if (dirMatcher.shouldIgnoreEntry(entry.name, entry.isDirectory())) continue
      const full = join(next.dir, entry.name)
      const childRel = next.relDir ? `${next.relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        queue.push({ dir: full, relDir: childRel.replace(/\\/g, '/') })
      } else if (entry.isFile()) {
        files.push(full)
      }
    }
  }

  return files
}

/** Case-insensitive substring or optional regex search over filenames and text contents. */
export async function toolSearch(
  workspaceRoot: string,
  query: string,
  maxResults = 40,
  signal?: AbortSignal,
  regex = false
): Promise<string> {
  throwIfAborted(signal)
  const q = query.trim()
  if (!q) throw new Error('search query is required')

  let pattern: RegExp
  if (regex) {
    try {
      pattern = new RegExp(q, 'i')
    } catch {
      throw new Error('Invalid regex pattern')
    }
  } else {
    const lower = q.toLowerCase()
    pattern = {
      test: (s: string) => s.toLowerCase().includes(lower)
    } as RegExp
  }

  assertInsideWorkspace(workspaceRoot, '.')
  const files = await collectFiles(workspaceRoot, 5000, signal)
  throwIfAborted(signal)

  const hits: string[] = []

  for (let i = 0; i < files.length; i++) {
    throwIfAborted(signal)
    if (i > 0 && i % YIELD_EVERY_FILES === 0) {
      await yieldToEventLoop()
      throwIfAborted(signal)
    }
    if (hits.length >= maxResults) break

    const file = files[i]!
    const rel = relative(workspaceRoot, file).replace(/\\/g, '/')
    if (pattern.test(rel)) {
      hits.push(`file: ${rel}`)
      continue
    }
    const ext = extname(file).toLowerCase()
    if (!TEXT_EXTS.has(ext)) continue
    try {
      const st = statSync(file)
      if (st.size > 256 * 1024) continue
      const text = readFileSync(file, 'utf8')
      if (regex) {
        const match = pattern.exec(text)
        if (match) {
          const idx = match.index
          const line = text.slice(0, idx).split('\n').length
          const snippet = text.split('\n')[line - 1]?.trim().slice(0, 120) ?? ''
          hits.push(`${rel}:${line}: ${snippet}`)
        }
      } else {
        const idx = text.toLowerCase().indexOf(q.toLowerCase())
        if (idx >= 0) {
          const line = text.slice(0, idx).split('\n').length
          const snippet = text.split('\n')[line - 1]?.trim().slice(0, 120) ?? ''
          hits.push(`${rel}:${line}: ${snippet}`)
        }
      }
    } catch {
      // skip unreadable
    }
  }

  if (hits.length === 0) return `No matches for "${query}"`
  return hits.join('\n')
}
