import { app } from 'electron'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { logger } from '../../shared/logger'

const FALLBACK_ONELINER = 'You are Agent V, an agentic coding agent.'

function bundledHarnessPath(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, 'harness', 'default.md')
}

/** Read the bundled system harness. */
export function loadHarness(): string {
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
