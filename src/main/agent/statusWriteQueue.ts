import { readFile, writeFile, rename, mkdir } from 'fs/promises'
import { dirname, join, basename } from 'path'
import { existsSync } from 'fs'
import { RunStatusSchema, type RunStatus } from '../../shared/ipc'
import { logger } from '../../shared/logger'
import { invalidateListRunsCache } from './runListCache'

const STATUS_FLUSH_MS = 250

type Pending = {
  patch: Partial<RunStatus>
  /** Invalidate list-runs cache on flush when true. */
  invalidateList: boolean
  timer: ReturnType<typeof setTimeout> | null
  chain: Promise<void>
}

const pendingByDir = new Map<string, Pending>()

const TERMINAL_STATUSES = new Set(['done', 'error', 'cancelled'])

function isTerminalPatch(patch: Partial<RunStatus>): boolean {
  return Boolean(patch.status && TERMINAL_STATUSES.has(patch.status))
}

/** Meaningful enough to refresh the run list (not every step tick). */
function shouldInvalidateList(patch: Partial<RunStatus>): boolean {
  if (isTerminalPatch(patch)) return true
  if (patch.goal !== undefined) return true
  if (patch.status !== undefined && patch.status !== 'running') return true
  return false
}

async function readStatusFile(path: string): Promise<RunStatus> {
  const fallback: RunStatus = {
    status: 'running',
    step: 0,
    updatedAt: new Date().toISOString()
  }
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
    const parsed = RunStatusSchema.safeParse(raw)
    if (parsed.success) return parsed.data
  } catch {
    // keep default
  }
  return fallback
}

async function atomicWriteJsonAsync(target: string, data: unknown): Promise<void> {
  const dir = dirname(target)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
  await rename(temp, target)
}

async function flushDir(dir: string): Promise<void> {
  const entry = pendingByDir.get(dir)
  if (!entry) return
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = null
  }
  const patch = entry.patch
  const invalidateList = entry.invalidateList
  entry.patch = {}
  entry.invalidateList = false

  const path = join(dir, 'status.json')
  const run = entry.chain.then(async () => {
    if (Object.keys(patch).length === 0) return
    const current = await readStatusFile(path)
    const next: RunStatus = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    await atomicWriteJsonAsync(path, next)
    if (invalidateList) {
      const workspacePath = next.workspacePath ?? current.workspacePath
      if (workspacePath) invalidateListRunsCache(workspacePath)
    }
  }).catch((err) => {
    logger.warn('Failed to flush status.json', {
      scope: 'state',
      correlationId: basename(dir),
      err
    })
  })

  entry.chain = run
  await run
  if (pendingByDir.get(dir) === entry && Object.keys(entry.patch).length === 0) {
    // Keep entry if another patch arrived; otherwise drop when chain settles.
    if (entry.timer == null) {
      pendingByDir.delete(dir)
    }
  }
}

function ensurePending(dir: string): Pending {
  let entry = pendingByDir.get(dir)
  if (!entry) {
    entry = { patch: {}, invalidateList: false, timer: null, chain: Promise.resolve() }
    pendingByDir.set(dir, entry)
  }
  return entry
}

/**
 * Merge a status patch. Step ticks coalesce for STATUS_FLUSH_MS; terminal statuses
 * flush immediately. List-runs cache invalidates only on meaningful changes.
 */
export function enqueueStatusPatch(dir: string, patch: Partial<RunStatus>): void {
  const entry = ensurePending(dir)
  entry.patch = { ...entry.patch, ...patch }
  if (shouldInvalidateList(patch)) entry.invalidateList = true

  if (isTerminalPatch(patch)) {
    void flushDir(dir)
    return
  }

  if (entry.timer) return
  entry.timer = setTimeout(() => {
    entry.timer = null
    void flushDir(dir)
  }, STATUS_FLUSH_MS)
}

/** Force any coalesced status write to disk (end of run / resume). */
export async function flushStatusWrites(dir?: string): Promise<void> {
  if (dir) {
    await flushDir(dir)
    return
  }
  await Promise.all([...pendingByDir.keys()].map((d) => flushDir(d)))
}

/** Sync immediate write — used by createRun / orphan interrupt / tests that need disk now. */
export function writeStatusImmediateSync(
  dir: string,
  patch: Partial<RunStatus>,
  writeSync: (path: string, next: RunStatus) => void,
  readSync: (path: string) => RunStatus
): void {
  const entry = pendingByDir.get(dir)
  if (entry?.timer) {
    clearTimeout(entry.timer)
    entry.timer = null
  }
  const merged = { ...(entry?.patch ?? {}), ...patch }
  if (entry) {
    entry.patch = {}
    entry.invalidateList = false
  }
  const path = join(dir, 'status.json')
  const current = readSync(path)
  const next: RunStatus = {
    ...current,
    ...merged,
    updatedAt: new Date().toISOString()
  }
  writeSync(path, next)
  if (shouldInvalidateList(merged) || shouldInvalidateList(patch)) {
    const workspacePath = next.workspacePath ?? current.workspacePath
    if (workspacePath) invalidateListRunsCache(workspacePath)
  }
  pendingByDir.delete(dir)
}

/** @internal */
export function resetStatusWriteQueueForTests(): void {
  for (const entry of pendingByDir.values()) {
    if (entry.timer) clearTimeout(entry.timer)
  }
  pendingByDir.clear()
}

/** @internal */
export function statusWriteQueueSizeForTests(): number {
  return pendingByDir.size
}
