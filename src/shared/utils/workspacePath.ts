// Shared by main and renderer, so this must stay free of node:path — the renderer
// bundle externalizes it and the module would resolve to an empty browser shim.

const WINDOWS_DRIVE = /^([a-zA-Z]):([\\/]|$)/
const UNC_PREFIX = /^[\\/]{2}[^\\/]/

export function isWindowsStylePath(path: string): boolean {
  if (WINDOWS_DRIVE.test(path)) return true
  if (UNC_PREFIX.test(path)) return true
  return path.includes('\\') && !path.startsWith('/')
}

function collapseSegments(segments: string[]): string[] {
  const out: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out
}

function splitRoot(path: string, windows: boolean): { root: string; rest: string } {
  if (windows) {
    if (UNC_PREFIX.test(path)) return { root: '\\\\', rest: path.slice(2) }
    const drive = WINDOWS_DRIVE.exec(path)
    if (drive) {
      return { root: `${drive[1].toUpperCase()}:\\`, rest: path.slice(drive[0].length) }
    }
    return { root: '', rest: path }
  }
  return path.startsWith('/') ? { root: '/', rest: path.slice(1) } : { root: '', rest: path }
}

/** Normalize separators, drive casing, `.`/`..` segments and trailing slashes. */
export function canonicalizeWorkspacePath(workspacePath: string): string {
  const trimmed = workspacePath.trim()
  if (!trimmed) return ''
  const windows = isWindowsStylePath(trimmed)
  const separator = windows ? '\\' : '/'
  const { root, rest } = splitRoot(trimmed, windows)
  const segments = collapseSegments(rest.split(/[\\/]+/))
  const joined = segments.join(separator)
  if (!joined) return root || '.'
  return root + joined
}

function pathKey(path: string): string {
  return isWindowsStylePath(path) ? path.toLowerCase() : path
}

/**
 * Resolve `relPath` against the workspace root and reject anything that lands outside it.
 * Throws rather than returning null so no caller can accidentally ignore the check.
 */
export function assertInsideWorkspace(workspaceRoot: string, relPath: string): string {
  const root = canonicalizeWorkspacePath(workspaceRoot)
  const windows = isWindowsStylePath(root)
  const separator = windows ? '\\' : '/'
  const candidate =
    splitRoot(relPath.trim(), isWindowsStylePath(relPath)).root !== ''
      ? canonicalizeWorkspacePath(relPath)
      : canonicalizeWorkspacePath(`${root}${separator}${relPath}`)

  const rootKey = pathKey(root)
  const candidateKey = pathKey(candidate)
  const inside =
    candidateKey === rootKey ||
    candidateKey.startsWith(rootKey.endsWith(separator) ? rootKey : rootKey + separator)
  if (!inside) throw new Error(`Path escapes workspace: ${relPath}`)
  return candidate
}
