import { shell, app } from 'electron'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { canonicalizeWorkspacePath } from '../../shared/workspacePath'
import { workspaceId, workspaceMetaDir } from '../storage/paths'

const FALLBACK_ONELINER = 'You are Vyotiq, a helpful coding agent.'

/** Bundled system harness — the only authoritative copy. */
export function getHarnessPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'harness', 'default.md')
  }
  return join(app.getAppPath(), 'resources', 'harness', 'default.md')
}

export function loadHarness(): string {
  const path = getHarnessPath()
  if (!existsSync(path)) return FALLBACK_ONELINER
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return FALLBACK_ONELINER
  }
}

export async function openHarness(): Promise<void> {
  const path = getHarnessPath()
  if (!existsSync(path)) {
    throw new Error(`Harness not found: ${path}`)
  }
  const err = await shell.openPath(path)
  if (err) {
    throw new Error(err)
  }
}

/** Drop mistaken per-workspace / userData harness copies from earlier versions. */
export function cleanupLegacyHarnessArtifacts(workspaceRoot: string): void {
  const legacyProject = join(workspaceRoot, '.vyotiq', 'harness.md')
  if (existsSync(legacyProject)) {
    try {
      unlinkSync(legacyProject)
    } catch {
      // ignore
    }
  }

  const canonical = canonicalizeWorkspacePath(workspaceRoot)
  const legacyUserData = join(workspaceMetaDir(workspaceId(canonical)), 'harness.md')
  if (existsSync(legacyUserData)) {
    try {
      unlinkSync(legacyUserData)
    } catch {
      // ignore
    }
  }
}

export function cleanupAllLegacyHarnessArtifacts(workspacePaths: string[]): void {
  const seen = new Set<string>()
  for (const root of workspacePaths) {
    if (!root) continue
    const key = process.platform === 'win32' ? root.toLowerCase() : root
    if (seen.has(key)) continue
    seen.add(key)
    cleanupLegacyHarnessArtifacts(root)
  }
}
