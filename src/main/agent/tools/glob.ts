import { assertInsideWorkspace } from '../../../shared/workspacePath'
import { collectWorkspaceFiles, globToRegExp, throwIfAborted } from './walk'

const SCAN_CAP = 20_000
const DEFAULT_MAX_RESULTS = 100

/** List workspace files matching a glob, honouring .gitignore. */
export async function toolGlob(
  workspaceRoot: string,
  pattern: string,
  maxResults = DEFAULT_MAX_RESULTS,
  signal?: AbortSignal
): Promise<string> {
  const trimmed = pattern.trim()
  if (!trimmed) throw new Error('glob requires a non-empty pattern')

  assertInsideWorkspace(workspaceRoot, '.')
  const regex = globToRegExp(trimmed)
  const files = await collectWorkspaceFiles(workspaceRoot, SCAN_CAP, signal)
  throwIfAborted(signal)

  const matches = files
    .map((file) => file.rel)
    .filter((rel) => regex.test(rel))
    .sort((a, b) => a.localeCompare(b))

  if (matches.length === 0) {
    return `No files match ${trimmed}`
  }

  const shown = matches.slice(0, maxResults)
  const suffix =
    matches.length > shown.length
      ? `\n… ${matches.length - shown.length} more (raise maxResults or narrow the pattern)`
      : ''
  return `${shown.join('\n')}${suffix}`
}
