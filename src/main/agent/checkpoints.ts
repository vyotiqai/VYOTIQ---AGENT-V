import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { dirname, join, relative } from 'path'
import { randomUUID } from 'crypto'
import { resolveInsideWorkspace } from '../workspace/safePath'
import { atomicWriteFile, atomicWriteJson } from '@main/storage/atomicWrite'
import { logger } from '../../shared/logger'

export type CheckpointFileAction = 'created' | 'modified' | 'deleted'

export type CheckpointFileResolution = 'kept' | 'discarded'

export type CheckpointFileEntry = {
  /** Workspace-relative path using forward slashes. */
  path: string
  action: CheckpointFileAction
  /** False for recursive directory deletes (v1 cannot restore). */
  undoable: boolean
  /** Set when the user Keep/Discard resolves this path. */
  resolved?: CheckpointFileResolution
}

export type WriteCheckpointMeta = {
  id: string
  createdAt: string
  undone?: boolean
  /** True when every file is Keep/Discard resolved (or discarded via Undo). */
  resolved?: boolean
  files: CheckpointFileEntry[]
}

export type CheckpointIndex = {
  checkpoints: Array<{ id: string; createdAt: string; undone?: boolean }>
}

const activeSessions = new Map<string, InvokeWriteCheckpoint>()

function normalizeRelPath(rel: string): string {
  return rel.replace(/\\/g, '/')
}

function blobPathFor(checkpointDir: string, relPath: string): string {
  const parts = normalizeRelPath(relPath).split('/').filter(Boolean)
  if (parts.some((p) => p === '..')) {
    throw new Error('Invalid checkpoint path')
  }
  return join(checkpointDir, 'files', ...parts)
}

function loadIndex(runDir: string): CheckpointIndex {
  const p = join(runDir, 'checkpoints', 'index.json')
  if (!existsSync(p)) return { checkpoints: [] }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as CheckpointIndex
    return {
      checkpoints: Array.isArray(raw.checkpoints) ? raw.checkpoints : []
    }
  } catch {
    return { checkpoints: [] }
  }
}

function saveIndex(runDir: string, index: CheckpointIndex): void {
  const dir = join(runDir, 'checkpoints')
  mkdirSync(dir, { recursive: true })
  atomicWriteJson(join(dir, 'index.json'), index)
}

function loadMeta(runDir: string, id: string): WriteCheckpointMeta | null {
  const p = join(runDir, 'checkpoints', id, 'meta.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as WriteCheckpointMeta
  } catch {
    return null
  }
}

function saveMeta(runDir: string, meta: WriteCheckpointMeta): void {
  const dir = join(runDir, 'checkpoints', meta.id)
  mkdirSync(dir, { recursive: true })
  atomicWriteJson(join(dir, 'meta.json'), meta)
}

/** One turn (invoke) of agent writes; first prior per path wins. */
export class InvokeWriteCheckpoint {
  readonly id: string
  readonly createdAt: string
  private readonly runDir: string
  private readonly workspaceRoot: string
  private readonly files = new Map<string, CheckpointFileEntry>()
  private finalized = false

  constructor(runDir: string, workspaceRoot: string) {
    this.id = randomUUID()
    this.createdAt = new Date().toISOString()
    this.runDir = runDir
    this.workspaceRoot = workspaceRoot
  }

  private checkpointDir(): string {
    return join(this.runDir, 'checkpoints', this.id)
  }

  /**
   * Snapshot prior content before a write or delete.
   * @param pathArg Path as the tool received it (workspace-relative or absolute inside root).
   */
  recordPrior(
    pathArg: string,
    kind: 'write' | 'delete',
    opts?: { recursiveDir?: boolean }
  ): void {
    if (this.finalized) return
    const resolved = resolveInsideWorkspace(this.workspaceRoot, pathArg)
    const rel = normalizeRelPath(relative(this.workspaceRoot, resolved))
    if (!rel || rel.startsWith('..')) return
    if (this.files.has(rel)) return

    const exists = existsSync(resolved)
    if (kind === 'write') {
      if (!exists) {
        this.files.set(rel, { path: rel, action: 'created', undoable: true })
        return
      }
      const st = statSync(resolved)
      if (st.isDirectory()) {
        // Writing through edit tools targets files; ignore dirs.
        return
      }
      const dest = blobPathFor(this.checkpointDir(), rel)
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(resolved, dest)
      this.files.set(rel, { path: rel, action: 'modified', undoable: true })
      return
    }

    // delete
    if (!exists) return
    const st = statSync(resolved)
    if (st.isDirectory()) {
      this.files.set(rel, {
        path: rel,
        action: 'deleted',
        undoable: false
      })
      return
    }
    const dest = blobPathFor(this.checkpointDir(), rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(resolved, dest)
    this.files.set(rel, { path: rel, action: 'deleted', undoable: true })
  }

  /** Persist if any files were recorded; returns meta or null. */
  finalize(): WriteCheckpointMeta | null {
    if (this.finalized) return null
    this.finalized = true
    if (this.files.size === 0) return null

    const meta: WriteCheckpointMeta = {
      id: this.id,
      createdAt: this.createdAt,
      files: [...this.files.values()]
    }
    saveMeta(this.runDir, meta)
    const index = loadIndex(this.runDir)
    index.checkpoints.push({
      id: meta.id,
      createdAt: meta.createdAt
    })
    saveIndex(this.runDir, index)
    return meta
  }
}

export function beginWriteCheckpoint(
  runDir: string,
  workspaceRoot: string
): InvokeWriteCheckpoint {
  const existing = activeSessions.get(runDir)
  if (existing) return existing
  const session = new InvokeWriteCheckpoint(runDir, workspaceRoot)
  activeSessions.set(runDir, session)
  return session
}

export function getWriteCheckpoint(runDir: string | undefined): InvokeWriteCheckpoint | undefined {
  if (!runDir) return undefined
  return activeSessions.get(runDir)
}

export function finalizeWriteCheckpoint(runDir: string): WriteCheckpointMeta | null {
  const session = activeSessions.get(runDir)
  activeSessions.delete(runDir)
  if (!session) return null
  return session.finalize()
}

/** Drop an open session without persisting (e.g. tests). */
export function discardWriteCheckpoint(runDir: string): void {
  activeSessions.delete(runDir)
}

export type UndoWritesResult = {
  checkpointId: string
  restored: string[]
  skipped: string[]
}

export type ResolveWritesResult = {
  checkpointId: string
  kept: string[]
  discarded: string[]
  skipped: string[]
  fullyResolved: boolean
}

function resolveCheckpointId(runDir: string, checkpointId?: string): string {
  const index = loadIndex(runDir)
  let id = checkpointId
  if (!id) {
    for (let i = index.checkpoints.length - 1; i >= 0; i--) {
      const entry = index.checkpoints[i]!
      const meta = loadMeta(runDir, entry.id)
      if (meta && !meta.undone && !meta.resolved) {
        id = entry.id
        break
      }
    }
  }
  if (!id) {
    throw new Error('No undoable write checkpoint found for this run')
  }
  return id
}

function restoreOneFile(
  workspaceRoot: string,
  checkpointDir: string,
  file: CheckpointFileEntry
): 'restored' | 'skipped' {
  if (!file.undoable) return 'skipped'
  const resolved = resolveInsideWorkspace(workspaceRoot, file.path)
  try {
    if (file.action === 'created') {
      if (existsSync(resolved)) {
        rmSync(resolved, { force: true })
      }
      return 'restored'
    }
    const blob = blobPathFor(checkpointDir, file.path)
    if (!existsSync(blob)) return 'skipped'
    mkdirSync(dirname(resolved), { recursive: true })
    copyFileSync(blob, resolved)
    return 'restored'
  } catch (err) {
    logger.warn('Failed to restore checkpoint file', {
      scope: 'agent',
      path: file.path,
      err
    })
    return 'skipped'
  }
}

function markCheckpointFullyResolved(runDir: string, meta: WriteCheckpointMeta): void {
  meta.resolved = true
  meta.undone = true
  saveMeta(runDir, meta)
  const idx = loadIndex(runDir)
  const entry = idx.checkpoints.find((c) => c.id === meta.id)
  if (entry) entry.undone = true
  saveIndex(runDir, idx)
}

/**
 * Restore files from a checkpoint. If checkpointId is omitted, uses the latest
 * not-yet-undone checkpoint. Skips paths already Keep/Discard resolved.
 */
export function undoWrites(
  runDir: string,
  workspaceRoot: string,
  checkpointId?: string
): UndoWritesResult {
  const id = resolveCheckpointId(runDir, checkpointId)
  const meta = loadMeta(runDir, id)
  if (!meta) throw new Error(`Checkpoint not found: ${id}`)
  if (meta.undone || meta.resolved) throw new Error('That checkpoint was already undone')

  const checkpointDir = join(runDir, 'checkpoints', id)
  const restored: string[] = []
  const skipped: string[] = []

  for (const file of [...meta.files].reverse()) {
    if (file.resolved) {
      skipped.push(file.path)
      continue
    }
    const outcome = restoreOneFile(workspaceRoot, checkpointDir, file)
    if (outcome === 'restored') {
      file.resolved = 'discarded'
      restored.push(file.path)
    } else {
      skipped.push(file.path)
    }
  }

  markCheckpointFullyResolved(runDir, meta)
  return { checkpointId: id, restored, skipped }
}

/**
 * Keep and/or discard specific paths (or all unresolved when paths omitted for discard/keep all).
 */
export function resolveWrites(
  runDir: string,
  workspaceRoot: string,
  opts: {
    checkpointId?: string
    action: 'keep' | 'discard'
    /** When omitted, applies to all unresolved files. */
    paths?: string[]
  }
): ResolveWritesResult {
  const id = resolveCheckpointId(runDir, opts.checkpointId)
  const meta = loadMeta(runDir, id)
  if (!meta) throw new Error(`Checkpoint not found: ${id}`)
  if (meta.undone || meta.resolved) throw new Error('That checkpoint was already resolved')

  const targetPaths =
    opts.paths && opts.paths.length > 0
      ? new Set(opts.paths.map((p) => normalizeRelPath(p)))
      : null

  const checkpointDir = join(runDir, 'checkpoints', id)
  const kept: string[] = []
  const discarded: string[] = []
  const skipped: string[] = []

  for (const file of meta.files) {
    if (targetPaths && !targetPaths.has(file.path)) continue
    if (file.resolved) {
      skipped.push(file.path)
      continue
    }
    if (opts.action === 'keep') {
      file.resolved = 'kept'
      kept.push(file.path)
      continue
    }
    const outcome = restoreOneFile(workspaceRoot, checkpointDir, file)
    if (outcome === 'restored') {
      file.resolved = 'discarded'
      discarded.push(file.path)
    } else {
      // Non-undoable: still mark discarded so the UI can clear it.
      file.resolved = 'discarded'
      skipped.push(file.path)
    }
  }

  const fullyResolved = meta.files.every((f) => Boolean(f.resolved) || !f.undoable)
  // Treat non-undoable without resolution as needing an explicit resolve; if all
  // undoable are resolved, mark checkpoint done.
  const allHandled = meta.files.every((f) => Boolean(f.resolved))
  if (allHandled) {
    markCheckpointFullyResolved(runDir, meta)
  } else {
    saveMeta(runDir, meta)
  }

  return {
    checkpointId: id,
    kept,
    discarded,
    skipped,
    fullyResolved: allHandled || fullyResolved
  }
}

/** Test helper: clear all active sessions. */
export function resetWriteCheckpointsForTests(): void {
  activeSessions.clear()
}
