import { app } from 'electron'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { logger } from '../../shared/logger'

const FALLBACK_ONELINER = 'You are Agent V, an agentic coding agent.'

function bundledHarnessPath(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, 'harness', 'default.md')
}

function workspaceHarnessPath(workspaceRoot: string): string {
  return join(workspaceRoot, 'resources', 'harness', 'default.md')
}

/**
 * Read the system harness. Prefers workspace `resources/harness/default.md` when
 * present (e.g. after `/harness-apply`), else the bundled copy, else a one-liner.
 * Loaded once per invoke — applied text is seen on the next invoke / new run, not mid-step.
 */
export function loadHarness(workspaceRoot?: string): string {
  if (workspaceRoot) {
    const wsPath = workspaceHarnessPath(workspaceRoot)
    try {
      if (existsSync(wsPath)) {
        return readFileSync(wsPath, 'utf8')
      }
    } catch (err) {
      logger.warn('Workspace harness unreadable; trying bundled', {
        scope: 'harness',
        path: wsPath,
        err
      })
    }
  }

  const harnessPath = bundledHarnessPath()
  try {
    if (!existsSync(harnessPath)) {
      logger.warn('Bundled harness missing; using fallback', {
        scope: 'harness',
        path: harnessPath
      })
      return FALLBACK_ONELINER
    }
    return readFileSync(harnessPath, 'utf8')
  } catch (err) {
    logger.warn('Bundled harness unreadable; using fallback', {
      scope: 'harness',
      path: harnessPath,
      err
    })
    return FALLBACK_ONELINER
  }
}

/** Drop mistaken per-workspace harness copies from earlier versions. */
export function purgeLegacyProjectHarness(workspaceRoot: string): void {
  const legacy = join(workspaceRoot, '.vyotiq', 'harness.md')
  if (!existsSync(legacy)) return
  try {
    unlinkSync(legacy)
  } catch {
    // ignore
  }
}
