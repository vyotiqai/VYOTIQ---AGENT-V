import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const userData = join(tmpdir(), `vyotiq-harness-${process.pid}-${Date.now()}`)
const appPath = join(tmpdir(), `vyotiq-app-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userData
      throw new Error(`unexpected getPath(${name})`)
    },
    getAppPath: () => appPath,
    isPackaged: false
  },
  shell: {
    openPath: vi.fn(async () => '')
  }
}))

import {
  cleanupLegacyHarnessArtifacts,
  cleanupAllLegacyHarnessArtifacts,
  getHarnessPath,
  loadHarness,
  openHarness
} from '@main/agent/harness'
import { ensureWorkspaceStorage, workspaceMetaDir, workspaceId } from '@main/storage/paths'
import { canonicalizeWorkspacePath } from '@shared/workspacePath'

describe('harness', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-ws-harness-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    mkdirSync(join(appPath, 'resources', 'harness'), { recursive: true })
    writeFileSync(getHarnessPath(), '# System harness\n', 'utf8')
    mkdirSync(userData, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
    if (existsSync(appPath)) rmSync(appPath, { recursive: true, force: true })
  })

  it('loads only from bundled resources/harness/default.md', () => {
    expect(loadHarness()).toBe('# System harness\n')
    expect(getHarnessPath()).toContain('resources')
    expect(getHarnessPath()).toContain('harness')
  })

  it('removes legacy project and userData harness copies', () => {
    const legacyDir = join(workspace, '.vyotiq')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'harness.md'), '# Legacy project harness\n', 'utf8')

    ensureWorkspaceStorage(workspace)
    const id = workspaceId(canonicalizeWorkspacePath(workspace))
    const userDataHarness = join(workspaceMetaDir(id), 'harness.md')
    writeFileSync(userDataHarness, '# Legacy userData harness\n', 'utf8')

    cleanupLegacyHarnessArtifacts(workspace)

    expect(existsSync(join(legacyDir, 'harness.md'))).toBe(false)
    expect(existsSync(userDataHarness)).toBe(false)
    expect(readFileSync(getHarnessPath(), 'utf8')).toBe('# System harness\n')
  })

  it('openHarness opens the bundled file', async () => {
    const { shell } = await import('electron')
    await openHarness()
    expect(shell.openPath).toHaveBeenCalledWith(getHarnessPath())
  })

  it('cleanupAllLegacyHarnessArtifacts dedupes workspace paths', () => {
    const legacyDir = join(workspace, '.vyotiq')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'harness.md'), '# Legacy\n', 'utf8')

    cleanupAllLegacyHarnessArtifacts([workspace, workspace])

    expect(existsSync(join(legacyDir, 'harness.md'))).toBe(false)
  })
})
