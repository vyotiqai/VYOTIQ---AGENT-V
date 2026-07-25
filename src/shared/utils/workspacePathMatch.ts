import { canonicalizeWorkspacePath, isWindowsStylePath } from './workspacePath'

/** Compare two workspace paths, ignoring case only for Windows-style paths. */
export function workspacePathsEqual(a: string, b: string): boolean {
  const left = canonicalizeWorkspacePath(a)
  const right = canonicalizeWorkspacePath(b)
  if (isWindowsStylePath(left) || isWindowsStylePath(right)) {
    return left.toLowerCase() === right.toLowerCase()
  }
  return left === right
}
