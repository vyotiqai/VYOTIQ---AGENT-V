import { app, dialog, BrowserWindow } from 'electron'
import {
  existsSync,
  readFileSync,
  unlinkSync
} from 'fs'
import { join } from 'path'
import {
  WorkspacesStateSchema,
  WorkspaceUiStateSchema,
  type WorkspacesState,
  type WorkspaceSettingsOverride,
  type WorkspaceUiState
} from '../../shared/ipc'
import { logger } from '../../shared/logger'
import { canonicalizeWorkspacePath, workspacePathsEqual } from '../../shared/workspacePath'
import { cleanupLegacyHarnessArtifacts } from '../agent/harness'
import { interruptOrphanRuns } from '../agent/state'
import { readLegacyWorkspacePath } from '@main/settings/settings'
import { atomicWriteJson } from '../storage/atomicWrite'
import { ensureWorkspaceStorage, workspaceId } from '../storage/paths'
import { migrateLegacySessions } from '@main/storage/migrations/migrateSessions'

const RECENT_MAX = 20

function workspacesPath(): string {
  return join(app.getPath('userData'), 'workspaces.json')
}

function defaultUiState(): WorkspaceUiState {
  return {
    activeRunId: null,
    openRunIds: [],
    scrollTop: 0,
    scrollTopByRunId: {},
    composerDraft: ''
  }
}

export function defaultWorkspacesState(): WorkspacesState {
  return {
    version: 2,
    workspaceIdsByPath: {},
    legacySessionsMigrated: false,
    openPaths: [],
    activePath: null,
    recentPaths: [],
    uiStateByPath: {},
    settingsOverridesByPath: {}
  }
}

function writeWorkspacesAtomic(state: WorkspacesState): void {
  const validated = WorkspacesStateSchema.parse(state)
  atomicWriteJson(workspacesPath(), validated)
}

function registerWorkspaceId(
  state: WorkspacesState,
  workspacePath: string
): WorkspacesState {
  const { workspaceId: id } = ensureWorkspaceStorage(workspacePath)
  return {
    ...state,
    workspaceIdsByPath: {
      ...state.workspaceIdsByPath,
      [workspacePath]: id
    }
  }
}

function upgradeWorkspacesStateV1(raw: Record<string, unknown>): WorkspacesState {
  const merged = mergePartialWorkspacesState(raw)
  const paths = dedupeRecent([...merged.openPaths, ...merged.recentPaths])
  const workspaceIdsByPath: Record<string, string> = { ...merged.workspaceIdsByPath }
  for (const p of paths) {
    const canonical = canonicalizeWorkspacePath(p)
    workspaceIdsByPath[canonical] = workspaceId(canonical)
  }
  return {
    ...merged,
    version: 2,
    workspaceIdsByPath
  }
}

function migrateLegacyWorkspacePath(state: WorkspacesState): WorkspacesState {
  if (state.openPaths.length > 0) return state
  const legacy = readLegacyWorkspacePath()
  if (!legacy || !existsSync(legacy)) return state
  cleanupLegacyHarnessArtifacts(legacy)
  const next: WorkspacesState = {
    ...state,
    openPaths: [legacy],
    activePath: legacy,
    recentPaths: dedupeRecent([legacy, ...state.recentPaths])
  }
  writeWorkspacesAtomic(next)
  logger.info('Migrated legacy settings.workspacePath to workspaces.json', {
    scope: 'workspaces',
    path: legacy
  })
  return next
}

function dedupeRecent(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (!p) continue
    const key = process.platform === 'win32' ? p.toLowerCase() : p
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= RECENT_MAX) break
  }
  return out
}

function mergePartialWorkspacesState(raw: Record<string, unknown>): WorkspacesState {
  const merged = defaultWorkspacesState()
  const shape = WorkspacesStateSchema.shape
  for (const key of Object.keys(shape) as (keyof WorkspacesState)[]) {
    const value = raw[key]
    const field = shape[key].safeParse(value)
    if (field.success) {
      ;(merged as Record<string, unknown>)[key] = field.data
    }
  }
  return normalizeActivePath(merged)
}

/** Clear or realign activePath when it is not among openPaths. */
function normalizeActivePath(state: WorkspacesState): WorkspacesState {
  if (state.activePath == null) {
    return state.openPaths.length > 0 ? { ...state, activePath: state.openPaths[0]! } : state
  }
  const match = state.openPaths.find((p) => workspacePathsEqual(p, state.activePath!))
  if (match) {
    return match === state.activePath ? state : { ...state, activePath: match }
  }
  return { ...state, activePath: state.openPaths[0] ?? null }
}

function findOpenPath(state: WorkspacesState, path: string): string | undefined {
  return state.openPaths.find((p) => workspacePathsEqual(p, path))
}

function remapWorkspacePath(state: WorkspacesState, from: string, to: string): WorkspacesState {
  if (workspacePathsEqual(from, to)) {
    if (from === to) return state
    return remapWorkspacePath(state, from, canonicalizeWorkspacePath(to))
  }

  const remapPath = (p: string | null): string | null => {
    if (p === null) return null
    return workspacePathsEqual(p, from) ? to : p
  }

  const remapList = (paths: string[]): string[] =>
    dedupeRecent(paths.map((p) => (workspacePathsEqual(p, from) ? to : p)))

  const uiStateByPath = { ...state.uiStateByPath }
  if (uiStateByPath[from] !== undefined) {
    uiStateByPath[to] = uiStateByPath[from]
    delete uiStateByPath[from]
  }

  const settingsOverridesByPath = { ...state.settingsOverridesByPath }
  if (settingsOverridesByPath[from] !== undefined) {
    settingsOverridesByPath[to] = settingsOverridesByPath[from]
    delete settingsOverridesByPath[from]
  }

  const workspaceIdsByPath = { ...state.workspaceIdsByPath }
  if (workspaceIdsByPath[from] !== undefined) {
    workspaceIdsByPath[to] = workspaceIdsByPath[from]
    delete workspaceIdsByPath[from]
  } else {
    workspaceIdsByPath[to] = workspaceId(canonicalizeWorkspacePath(to))
  }

  return {
    ...state,
    openPaths: remapList(state.openPaths),
    recentPaths: remapList(state.recentPaths),
    activePath: remapPath(state.activePath),
    uiStateByPath,
    settingsOverridesByPath,
    workspaceIdsByPath
  }
}

export function findWorkspaceSettingsOverride(
  state: WorkspacesState,
  workspacePath: string
): WorkspaceSettingsOverride | null {
  const canonical = canonicalizeWorkspacePath(workspacePath)
  for (const key of Object.keys(state.settingsOverridesByPath)) {
    if (workspacePathsEqual(key, canonical) || workspacePathsEqual(key, workspacePath)) {
      return state.settingsOverridesByPath[key] ?? null
    }
  }
  for (const p of state.openPaths) {
    if (workspacePathsEqual(p, canonical) || workspacePathsEqual(p, workspacePath)) {
      return state.settingsOverridesByPath[p] ?? null
    }
  }
  return null
}

function touchRecent(state: WorkspacesState, path: string): WorkspacesState {
  return {
    ...state,
    recentPaths: dedupeRecent([path, ...state.recentPaths.filter((p) => p !== path)])
  }
}

function ensureUiState(state: WorkspacesState, path: string): WorkspacesState {
  if (state.uiStateByPath[path]) return state
  return {
    ...state,
    uiStateByPath: {
      ...state.uiStateByPath,
      [path]: defaultUiState()
    }
  }
}

export function readWorkspacesState(): WorkspacesState {
  const p = workspacesPath()
  if (!existsSync(p)) {
    const initial = migrateLegacyWorkspacePath(defaultWorkspacesState())
    if (!existsSync(p)) writeWorkspacesAtomic(initial)
    return initial
  }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown
    if (typeof raw === 'object' && raw !== null && (raw as { version?: number }).version === 1) {
      const upgraded = upgradeWorkspacesStateV1(raw as Record<string, unknown>)
      writeWorkspacesAtomic(upgraded)
      return normalizeActivePath(migrateLegacyWorkspacePath(upgraded))
    }
    const parsed = WorkspacesStateSchema.safeParse(raw)
    if (!parsed.success) {
      logger.warn('workspaces.json schema mismatch; merging known fields', { scope: 'workspaces' })
      const recovered = migrateLegacyWorkspacePath(
        mergePartialWorkspacesState(
          typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
        )
      )
      writeWorkspacesAtomic(recovered)
      return recovered
    }
    return normalizeActivePath(migrateLegacyWorkspacePath(parsed.data))
  } catch (err) {
    logger.warn('Failed to read workspaces.json; resetting', { scope: 'workspaces', err })
    const reset = migrateLegacyWorkspacePath(defaultWorkspacesState())
    writeWorkspacesAtomic(reset)
    return reset
  }
}

export function saveWorkspacesState(state: WorkspacesState): WorkspacesState {
  const next = WorkspacesStateSchema.parse(normalizeActivePath(state))
  writeWorkspacesAtomic(next)
  return next
}

export function getWorkspaces(): WorkspacesState {
  return readWorkspacesState()
}

export function interruptOrphanRunsForWorkspaces(state: WorkspacesState): number {
  const paths = dedupeRecent([...state.openPaths, ...state.recentPaths])
  return interruptOrphanRuns(paths)
}

export async function addWorkspace(
  win: BrowserWindow | null,
  path?: string
): Promise<WorkspacesState> {
  let root = path?.trim() ?? ''
  if (!root) {
    const opts: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) {
      return readWorkspacesState()
    }
    root = result.filePaths[0]
  }
  if (!existsSync(root)) {
    throw new Error(`Workspace not found: ${root}`)
  }
  root = canonicalizeWorkspacePath(root)
  cleanupLegacyHarnessArtifacts(root)

  let state = readWorkspacesState()
  state = registerWorkspaceId(state, root)
  const alreadyOpen = Boolean(findOpenPath(state, root))
  // Only sweep crash orphans when first opening a workspace — re-activating an
  // already-open tab must not cancel in-flight runs (also guarded by isActive).
  if (!alreadyOpen) {
    interruptOrphanRuns([root])
  }

  const existingOpen = findOpenPath(state, root)
  if (existingOpen && existingOpen !== root) {
    state = remapWorkspacePath(state, existingOpen, root)
  }

  if (!findOpenPath(state, root)) {
    state = {
      ...touchRecent(state, root),
      openPaths: [...state.openPaths, root],
      activePath: root
    }
  } else {
    state = { ...touchRecent(state, root), activePath: root }
  }
  state = ensureUiState(state, root)
  let saved = saveWorkspacesState(state)
  if (saved.needsWorkspaceForMigration) {
    migrateLegacySessions()
    saved = readWorkspacesState()
  }
  return saved
}

export function removeWorkspace(path: string): WorkspacesState {
  const state = readWorkspacesState()
  const open = findOpenPath(state, path)
  if (!open) return state
  const openPaths = state.openPaths.filter((p) => !workspacePathsEqual(p, open))
  let activePath = state.activePath
  if (activePath != null && workspacePathsEqual(activePath, open)) {
    activePath = openPaths[0] ?? null
  }
  return saveWorkspacesState({
    ...state,
    openPaths,
    activePath
  })
}

export function setActiveWorkspace(path: string): WorkspacesState {
  const state = readWorkspacesState()
  const open = findOpenPath(state, path)
  if (!open) {
    throw new Error('Workspace is not open')
  }
  const next = ensureUiState(touchRecent(state, open), open)
  return saveWorkspacesState({ ...next, activePath: open })
}

export function updateWorkspaceUiState(path: string, ui: WorkspaceUiState): true {
  const parsed = WorkspaceUiStateSchema.parse(ui)
  const state = readWorkspacesState()
  const key = findOpenPath(state, path) ?? canonicalizeWorkspacePath(path)
  saveWorkspacesState({
    ...state,
    uiStateByPath: {
      ...state.uiStateByPath,
      [key]: parsed
    }
  })
  return true
}

export function setWorkspaceSettingsOverride(
  path: string,
  override: WorkspaceSettingsOverride | null
): WorkspacesState {
  const state = readWorkspacesState()
  const key = findOpenPath(state, path) ?? canonicalizeWorkspacePath(path)
  const settingsOverridesByPath = { ...state.settingsOverridesByPath }
  if (override === null) {
    delete settingsOverridesByPath[key]
  } else {
    settingsOverridesByPath[key] = override
  }
  return saveWorkspacesState({ ...state, settingsOverridesByPath })
}

export function patchWorkspacesState(patch: Partial<WorkspacesState>): WorkspacesState {
  const state = readWorkspacesState()
  return saveWorkspacesState({ ...state, ...patch })
}

/** Test helper — remove workspaces.json */
export function resetWorkspacesForTests(): void {
  const p = workspacesPath()
  if (existsSync(p)) {
    try {
      unlinkSync(p)
    } catch {
      // ignore
    }
  }
}
