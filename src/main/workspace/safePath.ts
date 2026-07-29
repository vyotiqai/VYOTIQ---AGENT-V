import { existsSync, realpathSync } from 'fs'
import { basename, dirname, join } from 'path'
import {
  assertInsideWorkspace,
  canonicalizeWorkspacePath,
  isWindowsStylePath
} from '../../shared/utils/workspacePath'

function pathKey(path: string): string {
  return isWindowsStylePath(path) ? path.toLowerCase() : path
}

function isInsideRoot(resolved: string, realRoot: string): boolean {
  const rootKey = pathKey(canonicalizeWorkspacePath(realRoot))
  const resolvedKey = pathKey(canonicalizeWorkspacePath(resolved))
  const sep = isWindowsStylePath(realRoot) ? '\\' : '/'
  return resolvedKey === rootKey || resolvedKey.startsWith(rootKey + sep)
}

/**
 * Resolve a workspace-relative path and reject symlink escapes.
 * String containment alone is not enough — a symlink inside the workspace can
 * point outside it.
 */
export function resolveInsideWorkspace(workspaceRoot: string, relPath: string): string {
  const candidate = assertInsideWorkspace(workspaceRoot, relPath)
  const realRoot = realpathSync(canonicalizeWorkspacePath(workspaceRoot))

  if (existsSync(candidate)) {
    const real = realpathSync(candidate)
    if (!isInsideRoot(real, realRoot)) {
      throw new Error(`Path escapes workspace: ${relPath}`)
    }
    return real
  }

  // New file — walk up to the nearest existing ancestor and resolve from there.
  const tail: string[] = []
  let probe = candidate
  while (!existsSync(probe)) {
    tail.unshift(basename(probe))
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }

  if (!existsSync(probe)) {
    return candidate
  }

  const realBase = realpathSync(probe)
  if (!isInsideRoot(realBase, realRoot)) {
    throw new Error(`Path escapes workspace: ${relPath}`)
  }

  const resolved = tail.length ? join(realBase, ...tail) : realBase
  if (!isInsideRoot(resolved, realRoot)) {
    throw new Error(`Path escapes workspace: ${relPath}`)
  }
  return resolved
}
