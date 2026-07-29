import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalizeWorkspacePath } from '@shared/workspacePath'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const userData = join(tmpdir(), `vyotiq-ws-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userData
      throw new Error(`unexpected getPath(${name})`)
    },
    getAppPath: () => '/tmp/vyotiq-app',
    isPackaged: false
  },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
  }
}))

import {
  addWorkspace,
  defaultWorkspacesState,
  interruptOrphanRunsForWorkspaces,
  readWorkspacesState,
  removeWorkspace,
  resetWorkspacesForTests,
  saveWorkspacesState,
  setActiveWorkspace,
  setWorkspaceSettingsOverride
} from '@main/workspace/workspaces'
import { createRun } from '@main/agent/state'
import { resolveRunDir, workspaceSessionsRoot } from '@main/storage/paths'

describe('workspaces registry', () => {
  let workspaceA: string
  let workspaceB: string

  beforeEach(() => {
    workspaceA = join(tmpdir(), `vyotiq-wsa-${process.pid}-${Date.now()}`)
    workspaceB = join(tmpdir(), `vyotiq-wsb-${process.pid}-${Date.now()}`)
    mkdirSync(workspaceA, { recursive: true })
    mkdirSync(workspaceB, { recursive: true })
    resetWorkspacesForTests()
  })

  afterEach(() => {
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
    resetWorkspacesForTests()
  })

  it('writes workspaces.json atomically on first read', () => {
    const state = readWorkspacesState()
    expect(state.version).toBe(2)
    expect(existsSync(join(userData, 'workspaces.json'))).toBe(true)
    expect(readFileSync(join(userData, 'workspaces.json'), 'utf8')).not.toContain('.tmp')
  })

  it('migrates legacy settings.workspacePath on first read', () => {
    mkdirSync(userData, { recursive: true })
    writeFileSync(
      join(userData, 'settings.json'),
      JSON.stringify({
        provider: 'ollama',
        model: 'qwen2.5',
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        theme: 'system',
        workspacePath: workspaceA
      }),
      'utf8'
    )
    const state = readWorkspacesState()
    expect(state.openPaths).toContain(workspaceA)
    expect(state.activePath).toBe(workspaceA)
    expect(state.recentPaths[0]).toBe(workspaceA)
  })

  it('adds workspace paths and updates recents', async () => {
    const first = await addWorkspace(null, workspaceA)
    expect(first.openPaths).toContain(workspaceA)
    expect(first.activePath).toBe(workspaceA)
    expect(first.recentPaths[0]).toBe(workspaceA)
    expect(existsSync(workspaceSessionsRoot(workspaceA))).toBe(true)

    const second = await addWorkspace(null, workspaceB)
    expect(second.openPaths).toEqual([workspaceA, workspaceB])
    expect(second.activePath).toBe(workspaceB)
    expect(second.recentPaths[0]).toBe(workspaceB)
  })

  it('removes from openPaths but keeps ui state for restore', () => {
    saveWorkspacesState({
      ...defaultWorkspacesState(),
      openPaths: [workspaceA, workspaceB],
      activePath: workspaceB,
      uiStateByPath: {
        [workspaceA]: {
          activeRunId: 'run-a',
          openRunIds: ['run-a'],
          scrollTop: 12,
          composerDraft: 'draft'
        }
      }
    })
    const next = removeWorkspace(workspaceA)
    expect(next.openPaths).toEqual([workspaceB])
    expect(next.uiStateByPath[workspaceA]?.composerDraft).toBe('draft')
  })

  it('sets active workspace and settings overrides', () => {
    saveWorkspacesState({
      ...defaultWorkspacesState(),
      openPaths: [workspaceA, workspaceB],
      activePath: workspaceA
    })
    const active = setActiveWorkspace(workspaceB)
    expect(active.activePath).toBe(workspaceB)
    expect(active.recentPaths[0]).toBe(workspaceB)

    const withOverride = setWorkspaceSettingsOverride(workspaceB, {
      useOverride: true,
      provider: 'openai',
      model: 'gpt-4.1'
    })
    expect(withOverride.settingsOverridesByPath[workspaceB]).toEqual({
      useOverride: true,
      provider: 'openai',
      model: 'gpt-4.1'
    })
  })

  it('recovers partial workspaces.json instead of full reset', () => {
    mkdirSync(userData, { recursive: true })
    writeFileSync(
      join(userData, 'workspaces.json'),
      JSON.stringify({
        version: 2,
        workspaceIdsByPath: {},
        legacySessionsMigrated: true,
        openPaths: 'invalid',
        activePath: workspaceA,
        recentPaths: [workspaceA],
        uiStateByPath: {
          [workspaceA]: {
            activeRunId: 'run-a',
            openRunIds: ['run-a'],
            scrollTop: 0,
            composerDraft: 'keep-me'
          }
        },
        settingsOverridesByPath: {}
      }),
      'utf8'
    )

    const state = readWorkspacesState()
    expect(state.openPaths).toEqual([])
    expect(state.recentPaths).toEqual([workspaceA])
    // activePath must not point at a closed workspace after partial recovery.
    expect(state.activePath).toBeNull()
    expect(state.uiStateByPath[workspaceA]?.composerDraft).toBe('keep-me')
    expect(state.legacySessionsMigrated).toBe(true)
  })

  it('canonicalizes workspace path on add', async () => {
    const nested = join(workspaceA, 'nested', '..')
    const added = await addWorkspace(null, nested)
    expect(added.openPaths).toContain(canonicalizeWorkspacePath(workspaceA))
    expect(added.activePath).toBe(canonicalizeWorkspacePath(workspaceA))
  })

  it('interruptOrphanRunsForWorkspaces scans open and recent paths', () => {
    const runId = 'recent-orphan'
    createRun(workspaceB, runId, 'orphan')
    const runsDir = join(resolveRunDir(workspaceB, runId), 'status.json')
    writeFileSync(
      runsDir,
      JSON.stringify({
        status: 'running',
        step: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        goal: 'stuck'
      }),
      'utf8'
    )

    const state = saveWorkspacesState({
      ...defaultWorkspacesState(),
      openPaths: [workspaceA],
      activePath: workspaceA,
      recentPaths: [workspaceB]
    })

    const count = interruptOrphanRunsForWorkspaces(state)
    expect(count).toBe(1)

    const status = JSON.parse(readFileSync(runsDir, 'utf8')) as { status: string }
    expect(status.status).toBe('cancelled')
  })

  it('retries legacy session migration when adding a workspace', async () => {
    const sessionsDir = join(userData, 'sessions', 'blocked-on-add')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(
      join(sessionsDir, 'status.json'),
      JSON.stringify({
        status: 'done',
        updatedAt: '2026-01-01T00:00:00.000Z',
        goal: 'legacy'
      }),
      'utf8'
    )
    saveWorkspacesState({
      ...defaultWorkspacesState(),
      legacySessionsMigrated: false,
      needsWorkspaceForMigration: true,
      pendingMigrationCount: 1
    })

    const next = await addWorkspace(null, workspaceA)
    expect(next.legacySessionsMigrated).toBe(true)
    expect(next.needsWorkspaceForMigration).toBe(false)
    expect(existsSync(resolveRunDir(workspaceA, 'blocked-on-add'))).toBe(true)
    expect(existsSync(sessionsDir)).toBe(false)
  })
})
