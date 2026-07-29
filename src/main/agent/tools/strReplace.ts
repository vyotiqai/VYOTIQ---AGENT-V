import { existsSync, readFileSync } from 'fs'
import { resolveInsideWorkspace } from '../../workspace/safePath'
import { atomicWriteFile } from '@main/storage/atomicWrite'

/** Count non-overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let from = 0
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    count += 1
    from = at + needle.length
  }
  return count
}

/**
 * Replace exact text in a workspace file.
 * Fails when old_string is missing, or (unless replace_all) matches more than once.
 */
export function toolStrReplace(
  workspaceRoot: string,
  pathArg: string,
  oldString: string,
  newString: string,
  replaceAll = false
): string {
  const path = pathArg.trim()
  if (!path) throw new Error('str_replace requires a non-empty path')
  if (!oldString) throw new Error('str_replace requires a non-empty old_string')

  const resolved = resolveInsideWorkspace(workspaceRoot, path)
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${path}`)
  }

  const original = readFileSync(resolved, 'utf8')
  const matches = countOccurrences(original, oldString)
  if (matches === 0) {
    throw new Error(`old_string not found in ${path}`)
  }
  if (!replaceAll && matches > 1) {
    throw new Error(
      `old_string matched ${matches} times in ${path}; pass replace_all=true or provide a more unique old_string`
    )
  }

  const next = replaceAll
    ? original.split(oldString).join(newString)
    : original.replace(oldString, newString)

  if (next === original) {
    throw new Error(`str_replace left ${path} unchanged`)
  }

  atomicWriteFile(resolved, next)
  const label = replaceAll && matches > 1 ? `${matches} occurrences` : '1 occurrence'
  return `Replaced ${label} in ${path}`
}
