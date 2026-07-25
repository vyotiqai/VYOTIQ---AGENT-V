import { assertInsideWorkspace } from '../../../shared/workspacePath'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from 'fs'
import { basename, dirname, join } from 'path'

const MAX_BYTES = 512 * 1024
const DIR_LIST_CAP = 80
const SUGGEST_CAP = 8

export type ReadOptions = {
  offset?: number
  limit?: number
}

function listDirectoryEntries(resolved: string, relPath: string): string {
  const entries = readdirSync(resolved, { withFileTypes: true })
    .slice(0, DIR_LIST_CAP)
    .map((e) => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`)
  const suffix =
    entries.length >= DIR_LIST_CAP ? `\n… (listing capped at ${DIR_LIST_CAP})` : ''
  return [
    `Path is a directory, not a file: ${relPath}`,
    'Contents:',
    ...entries,
    suffix,
    'Use read on a file path, or search/terminal to explore further.'
  ]
    .filter(Boolean)
    .join('\n')
}

function suggestSimilarPaths(workspaceRoot: string, relPath: string): string[] {
  const parent = dirname(relPath)
  const target = basename(relPath).toLowerCase()
  const parentResolved = parent === '.' ? workspaceRoot : assertInsideWorkspace(workspaceRoot, parent)
  if (!existsSync(parentResolved)) return []
  try {
    const names = readdirSync(parentResolved)
    const fuzzy = names
      .filter((name) => {
        const lower = name.toLowerCase()
        const targetStem = target.replace(/\.[^.]+$/, '')
        const nameStem = lower.replace(/\.[^.]+$/, '')
        return (
          lower.includes(target) ||
          target.includes(nameStem) ||
          nameStem.includes(targetStem) ||
          targetStem.includes(nameStem)
        )
      })
      .slice(0, SUGGEST_CAP)
      .map((name) => (parent === '.' ? name : join(parent, name)).replace(/\\/g, '/'))
    if (fuzzy.length) return fuzzy
    return names
      .slice(0, SUGGEST_CAP)
      .map((name) => (parent === '.' ? name : join(parent, name)).replace(/\\/g, '/'))
  } catch {
    return []
  }
}

function formatMissingFileHint(workspaceRoot: string, relPath: string): string {
  const suggestions = suggestSimilarPaths(workspaceRoot, relPath)
  if (!suggestions.length) {
    return `File not found: ${relPath}. Verify the path exists in this workspace.`
  }
  return [
    `File not found: ${relPath}`,
    'Similar names in parent directory:',
    ...suggestions.map((s) => `- ${s}`)
  ].join('\n')
}

export function toolRead(
  workspaceRoot: string,
  pathArg: string,
  options: ReadOptions = {}
): string {
  const resolved = assertInsideWorkspace(workspaceRoot, pathArg)
  if (!existsSync(resolved)) {
    throw new Error(formatMissingFileHint(workspaceRoot, pathArg))
  }
  const st = statSync(resolved)
  if (st.isDirectory()) {
    return listDirectoryEntries(resolved, pathArg)
  }
  if (!st.isFile()) {
    throw new Error(`Not a file: ${pathArg}`)
  }

  const offset = Math.max(0, options.offset ?? 0)
  const limit = options.limit

  if (limit !== undefined || offset > 0) {
    const buf = readFileSync(resolved)
    const slice = buf.subarray(offset, limit !== undefined ? offset + limit : undefined)
    const header = `--- offset ${offset}${limit !== undefined ? `, limit ${limit}` : ''} of ${st.size} bytes ---\n`
    return header + slice.toString('utf8')
  }

  if (st.size > MAX_BYTES) {
    throw new Error(
      `File too large (${st.size} bytes, cap ${MAX_BYTES}). Use offset/limit to read a portion.`
    )
  }
  const buf = readFileSync(resolved)
  if (buf.includes(0)) {
    throw new Error(`Binary file detected: ${pathArg}. Read is text-only.`)
  }
  return buf.toString('utf8')
}
