import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type {
  AgentEvent,
  PersistedEvent,
  RunSummary,
  WorkspaceSettingsOverride,
  WorkspaceUiState,
  WorkspacesState
} from '@shared/ipc'
import { toLogErr } from '@shared/errors'
import { logger } from '@shared/logger'
import { workspacePathsEqual } from '@shared/workspacePathMatch'
import {
  createChatStreamController,
  type ChatStreamController
} from './createChatStreamController'

const ACTIVE_RUNS_POLL_MS = 5_000
const ACTIVE_RUNS_WARN_INTERVAL_MS = 60_000
const ORPHAN_SYNC_DEBOUNCE_MS = 600
const OPEN_RUN_TAB_LIMIT = 10
const UI_PERSIST_DEBOUNCE_MS = 300
const LIST_RUNS_DEBOUNCE_MS = 300

export type WorkspaceUiSlice = {
  scrollTop: number
  scrollTopByRunId: Record<string, number>
  composerDraft: string
}

const DRAFT_SCROLL_KEY = '__draft__'

function scrollKeyForRun(runId: string | null): string {
  return runId ?? DRAFT_SCROLL_KEY
}

export type WorkspaceContext = {
  path: string
  runs: RunSummary[]
  runsCapped: boolean
  runsError: string | null
  activeRunId: string | null
  openRunIds: string[]
  backgroundRunIds: Set<string>
  sessionQuery: string
  ui: WorkspaceUiSlice
  settingsOverride: WorkspaceSettingsOverride | null
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

function draftControllerKey(workspacePath: string): string {
  return `__draft__:${workspacePath}`
}

function uiStateFromContext(ctx: WorkspaceContext): WorkspaceUiState {
  const scrollTop =
    ctx.ui.scrollTopByRunId[scrollKeyForRun(ctx.activeRunId)] ?? ctx.ui.scrollTop
  return {
    activeRunId: ctx.activeRunId,
    openRunIds: [...ctx.openRunIds],
    scrollTop,
    scrollTopByRunId: { ...ctx.ui.scrollTopByRunId },
    composerDraft: ctx.ui.composerDraft
  }
}

function contextFromRegistry(path: string, registry: WorkspacesState): WorkspaceContext {
  const ui = registry.uiStateByPath[path] ?? defaultUiState()
  const scrollTopByRunId = { ...(ui.scrollTopByRunId ?? {}) }
  if (ui.scrollTop > 0 && ui.activeRunId && scrollTopByRunId[ui.activeRunId] === undefined) {
    scrollTopByRunId[ui.activeRunId] = ui.scrollTop
  } else if (ui.scrollTop > 0 && !ui.activeRunId && scrollTopByRunId[DRAFT_SCROLL_KEY] === undefined) {
    scrollTopByRunId[DRAFT_SCROLL_KEY] = ui.scrollTop
  }
  return {
    path,
    runs: [],
    runsCapped: false,
    runsError: null,
    activeRunId: ui.activeRunId,
    openRunIds: [...ui.openRunIds],
    backgroundRunIds: new Set(),
    sessionQuery: '',
    ui: {
      scrollTop: ui.scrollTop,
      scrollTopByRunId,
      composerDraft: ui.composerDraft
    },
    settingsOverride:
      findSettingsOverride(registry.settingsOverridesByPath, path) ?? null
  }
}

function findSettingsOverride(
  overrides: WorkspacesState['settingsOverridesByPath'],
  path: string
): WorkspaceSettingsOverride | null {
  if (overrides[path] !== undefined) return overrides[path] ?? null
  for (const key of Object.keys(overrides)) {
    if (workspacePathsEqual(key, path)) return overrides[key] ?? null
  }
  return null
}

export function useWorkspaceManager() {
  const [registry, setRegistry] = useState<WorkspacesState | null>(null)
  const [contexts, setContexts] = useState<Record<string, WorkspaceContext>>({})
  const [activeRuns, setActiveRuns] = useState<{ runId: string; workspacePath: string }[]>([])
  const [revision, setRevision] = useState(0)
  const [scrollRestoreToken, setScrollRestoreToken] = useState(0)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const controllersRef = useRef(new Map<string, ChatStreamController>())
  const contextsRef = useRef(contexts)
  const persistTimersRef = useRef(new Map<string, number>())
  const eventBufferRef = useRef(new Map<string, AgentEvent[]>())
  const runIdToWorkspaceRef = useRef(new Map<string, string>())
  const controllerLruRef = useRef<string[]>([])
  const backgroundRunIdsRef = useRef(new Set<string>())
  const refreshRunsRef = useRef<(path: string) => Promise<void>>(async () => {})
  const lastActiveRunsWarnAtRef = useRef(0)
  const orphanSyncTimersRef = useRef(new Map<string, number>())

  const bump = useCallback(() => setRevision((r) => r + 1), [])

  useEffect(() => {
    const merged: Record<string, WorkspaceContext> = { ...contexts }
    for (const path of Object.keys(contextsRef.current)) {
      const refCtx = contextsRef.current[path]
      const stateCtx = merged[path]
      if (!refCtx) continue
      if (!stateCtx) {
        merged[path] = refCtx
        continue
      }
      const refScroll = refCtx.ui.scrollTopByRunId
      const stateScroll = stateCtx.ui.scrollTopByRunId
      const scrollChanged =
        refCtx.ui.scrollTop !== stateCtx.ui.scrollTop ||
        Object.keys(refScroll).some((key) => refScroll[key] !== stateScroll[key])
      if (scrollChanged) {
        merged[path] = {
          ...stateCtx,
          ui: {
            ...stateCtx.ui,
            scrollTop: refCtx.ui.scrollTop,
            scrollTopByRunId: { ...stateScroll, ...refScroll }
          }
        }
      }
    }
    contextsRef.current = merged
  }, [contexts])

  const schedulePersistUiState = useCallback((path: string, snapshot?: WorkspaceContext) => {
    const existing = persistTimersRef.current.get(path)
    if (existing) window.clearTimeout(existing)
    const timerId = window.setTimeout(() => {
      persistTimersRef.current.delete(path)
      const ctx = snapshot ?? contextsRef.current[path]
      if (!ctx || !window.vyotiq?.updateWorkspaceUiState) return
      void window.vyotiq.updateWorkspaceUiState(path, uiStateFromContext(ctx)).then((res) => {
        if (!res.ok) {
          logger.warn('updateWorkspaceUiState failed', {
            scope: 'workspaces',
            path,
            err: toLogErr(res.error)
          })
        }
      })
    }, UI_PERSIST_DEBOUNCE_MS)
    persistTimersRef.current.set(path, timerId)
  }, [])

  const flushPersistUiState = useCallback((path?: string) => {
    if (path) {
      const timer = persistTimersRef.current.get(path)
      if (timer) {
        window.clearTimeout(timer)
        persistTimersRef.current.delete(path)
      }
    } else {
      for (const timer of persistTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      persistTimersRef.current.clear()
    }
    const paths = path ? [path] : Object.keys(contextsRef.current)
    for (const workspacePath of paths) {
      const ctx = contextsRef.current[workspacePath]
      if (!ctx) continue
      const ui = uiStateFromContext(ctx)
      const api = window.vyotiq
      if (!api) continue
      const sync = (
        api as typeof api & {
          updateWorkspaceUiStateSync?: (p: string, u: WorkspaceUiState) => void
        }
      ).updateWorkspaceUiStateSync
      if (sync) {
        sync(workspacePath, ui)
      } else {
        void api.updateWorkspaceUiState?.(workspacePath, ui)
      }
    }
  }, [])

  const flushBufferedEvents = useCallback(
    (runId: string, ctrl: ChatStreamController) => {
      const buffered = eventBufferRef.current.get(runId)
      if (!buffered?.length) return
      eventBufferRef.current.delete(runId)
      for (const event of buffered) ctrl.handleEvent(event)
    },
    []
  )

  const touchLru = useCallback((runId: string) => {
    const lru = controllerLruRef.current
    const idx = lru.indexOf(runId)
    if (idx >= 0) lru.splice(idx, 1)
    lru.push(runId)
  }, [])

  const registerRunId = useCallback(
    (runId: string, workspacePath: string) => {
      runIdToWorkspaceRef.current.set(runId, workspacePath)
      touchLru(runId)
      const ctrl = controllersRef.current.get(runId)
      if (ctrl) flushBufferedEvents(runId, ctrl)
    },
    [flushBufferedEvents, touchLru]
  )

  const maybeEvictControllers = useCallback(
    (workspacePath: string, openRunIds: string[], activeRunId: string | null) => {
      if (openRunIds.length <= OPEN_RUN_TAB_LIMIT) return
      const excess = openRunIds.length - OPEN_RUN_TAB_LIMIT
      const candidates = controllerLruRef.current.filter((runId) => {
        if (!openRunIds.includes(runId)) return false
        if (runId === activeRunId) return false
        const ctrl = controllersRef.current.get(runId)
        if (!ctrl) return false
        if (ctrl.running || ctrl.pendingRun) return false
        return true
      })
      for (let i = 0; i < excess && i < candidates.length; i++) {
        const runId = candidates[i]
        controllersRef.current.get(runId)?.dispose()
        controllersRef.current.delete(runId)
        const lruIdx = controllerLruRef.current.indexOf(runId)
        if (lruIdx >= 0) controllerLruRef.current.splice(lruIdx, 1)
      }
    },
    []
  )

  const ensureController = useCallback(
    (workspacePath: string, runId: string | null): ChatStreamController => {
      const key = runId ?? draftControllerKey(workspacePath)
      const existing = controllersRef.current.get(key)
      if (existing) return existing

      const onRunIdAssigned = (assignedId: string): void => {
        const draftKey = draftControllerKey(workspacePath)
        const current = controllersRef.current.get(key)
        if (current && key !== assignedId) {
          const existingAssigned = controllersRef.current.get(assignedId)
          if (!existingAssigned || existingAssigned === current) {
            controllersRef.current.set(assignedId, current)
            if (controllersRef.current.get(key) === current) {
              controllersRef.current.delete(key)
            }
            touchLru(assignedId)
          } else if (key === draftKey && controllersRef.current.get(key) === current) {
            controllersRef.current.delete(key)
          }
        }
        registerRunId(assignedId, workspacePath)
        setContexts((prev) => {
          const ctx = prev[workspacePath]
          if (!ctx) return prev
          if (ctx.activeRunId === assignedId) return prev

          let openRunIds: string[]
          if (
            ctx.activeRunId &&
            ctx.activeRunId !== assignedId &&
            ctx.openRunIds.includes(ctx.activeRunId)
          ) {
            openRunIds = ctx.openRunIds.map((id) => (id === ctx.activeRunId ? assignedId : id))
            if (!openRunIds.includes(assignedId)) {
              openRunIds = [...openRunIds, assignedId]
            }
          } else if (ctx.openRunIds.includes(assignedId)) {
            openRunIds = ctx.openRunIds
          } else {
            openRunIds = [...ctx.openRunIds, assignedId]
          }

          maybeEvictControllers(workspacePath, openRunIds, assignedId)
          return {
            ...prev,
            [workspacePath]: {
              ...ctx,
              activeRunId: assignedId,
              openRunIds
            }
          }
        })
      }

      const onTerminal = (): void => {
        void refreshRunsRef.current(workspacePath)
      }

      const controller = createChatStreamController({
        workspacePath,
        runId,
        onRunIdAssigned,
        onTerminal
      })
      controller.subscribe(bump)
      controllersRef.current.set(key, controller)
      if (runId) registerRunId(runId, workspacePath)
      return controller
    },
    [bump, maybeEvictControllers, registerRunId, touchLru]
  )

  const refreshRuns = useCallback(
    async (workspacePath: string): Promise<void> => {
      if (!workspacePath.trim()) return
      if (!window.vyotiq?.listRuns) return
      const res = await window.vyotiq.listRuns(workspacePath)
      setContexts((prev) => {
        const ctx = prev[workspacePath]
        if (!ctx) return prev
        if (res.ok) {
          return {
            ...prev,
            [workspacePath]: {
              ...ctx,
              runs: res.data.runs,
              runsCapped: res.data.capped,
              runsError: null
            }
          }
        }
        logger.warn('listRuns failed', { scope: 'runs', err: toLogErr(res.error) })
        return {
          ...prev,
          [workspacePath]: {
            ...ctx,
            runs: [],
            runsCapped: false,
            runsError: res.error
          }
        }
      })
      bump()
    },
    [bump]
  )

  refreshRunsRef.current = refreshRuns

  const loadRunTranscript = useCallback(
    async (workspacePath: string, runId: string): Promise<void> => {
      const ctrl = ensureController(workspacePath, runId)
      if (ctrl.running || ctrl.pendingRun) return
      if (!window.vyotiq?.loadRun) return
      ctrl.setTranscriptLoading(true)
      try {
        const res = await window.vyotiq.loadRun(workspacePath, runId)
        if (!res.ok) {
          logger.warn('loadRun failed on restore', {
            scope: 'runs',
            correlationId: runId,
            err: res.error
          })
          setContexts((prev) => {
            const ctx = prev[workspacePath]
            if (!ctx) return prev
            return {
              ...prev,
              [workspacePath]: { ...ctx, runsError: res.error }
            }
          })
          bump()
          return
        }
        let events: PersistedEvent[] = []
        if (window.vyotiq.loadRunEvents) {
          const eventsRes = await window.vyotiq.loadRunEvents(workspacePath, runId)
          if (eventsRes.ok) events = eventsRes.data
        }
        ctrl.hydrateTranscript(res.data.messages, events)
        bump()
      } finally {
        ctrl.setTranscriptLoading(false)
      }
    },
    [bump, ensureController]
  )

  const loadRunIntoTab = useCallback(
    async (workspacePath: string, runId: string): Promise<void> => {
      await loadRunTranscript(workspacePath, runId)
    },
    [loadRunTranscript]
  )

  const reattachActiveRuns = useCallback(
    async (entries: { runId: string; workspacePath: string }[]): Promise<void> => {
      for (const entry of entries) {
        runIdToWorkspaceRef.current.set(entry.runId, entry.workspacePath)
        const ctrl = ensureController(entry.workspacePath, entry.runId)
        if (!ctrl.running) {
          await ctrl.reattachActiveRun(entry.runId)
        }
      }
      bump()
    },
    [bump, ensureController]
  )

  const pollActiveRuns = useCallback(async (): Promise<void> => {
    if (!window.vyotiq?.listActiveRuns) return
    const res = await window.vyotiq.listActiveRuns()
    if (!res.ok) {
      const now = Date.now()
      if (now - lastActiveRunsWarnAtRef.current >= ACTIVE_RUNS_WARN_INTERVAL_MS) {
        lastActiveRunsWarnAtRef.current = now
        logger.warn('listActiveRuns failed', { scope: 'runs', err: toLogErr(res.error) })
      }
      return
    }
    setActiveRuns(res.data)
    const activeIds = new Set(res.data.map((entry) => entry.runId))
    await reattachActiveRuns(res.data)
    for (const [key, ctrl] of controllersRef.current.entries()) {
      const id = ctrl.runId
      if (!id) continue
      if (activeIds.has(id)) {
        const pending = orphanSyncTimersRef.current.get(key)
        if (pending) {
          window.clearTimeout(pending)
          orphanSyncTimersRef.current.delete(key)
        }
        continue
      }
      if (!ctrl.running && !ctrl.pendingRun) {
        const pending = orphanSyncTimersRef.current.get(key)
        if (pending) {
          window.clearTimeout(pending)
          orphanSyncTimersRef.current.delete(key)
        }
        continue
      }
      if (orphanSyncTimersRef.current.has(key)) continue
      const timerId = window.setTimeout(() => {
        orphanSyncTimersRef.current.delete(key)
        if (typeof window === 'undefined') return
        const current = controllersRef.current.get(key)
        if (!current?.runId || current.runId !== id) return
        if (!current.running && !current.pendingRun) return
        void (async () => {
          if (window.vyotiq?.listActiveRuns) {
            const fresh = await window.vyotiq.listActiveRuns()
            if (fresh.ok && fresh.data.some((entry) => entry.runId === id)) return
          }
          await current.syncFromDisk(id)
          bump()
        })()
      }, ORPHAN_SYNC_DEBOUNCE_MS)
      orphanSyncTimersRef.current.set(key, timerId)
    }
    bump()
  }, [reattachActiveRuns, bump])

  const applyRegistry = useCallback((state: WorkspacesState) => {
    setRegistry(state)
    setContexts((prev) => {
      const next: Record<string, WorkspaceContext> = {}
      for (const path of state.openPaths) {
        const existing = prev[path]
        if (existing) {
          const ui = state.uiStateByPath[path] ?? defaultUiState()
          const scrollTopByRunId = { ...(ui.scrollTopByRunId ?? {}) }
          if (ui.scrollTop > 0 && ui.activeRunId && scrollTopByRunId[ui.activeRunId] === undefined) {
            scrollTopByRunId[ui.activeRunId] = ui.scrollTop
          }
          next[path] = {
            ...existing,
            activeRunId: existing.activeRunId ?? ui.activeRunId,
            openRunIds:
              existing.openRunIds.length > 0 ? existing.openRunIds : [...ui.openRunIds],
            ui: {
              scrollTop: ui.scrollTop,
              scrollTopByRunId:
                Object.keys(existing.ui.scrollTopByRunId).length > 0
                  ? existing.ui.scrollTopByRunId
                  : scrollTopByRunId,
              composerDraft:
                existing.ui.composerDraft !== ''
                  ? existing.ui.composerDraft
                  : ui.composerDraft
            },
            settingsOverride: state.settingsOverridesByPath[path] ?? null
          }
        } else {
          next[path] = contextFromRegistry(path, state)
        }
      }
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!window.vyotiq?.getWorkspaces) return
      const res = await window.vyotiq.getWorkspaces()
      if (cancelled) return
      if (!res.ok) {
        logger.error('getWorkspaces failed', { scope: 'workspaces', err: toLogErr(res.error) })
        setWorkspaceError(res.error)
        return
      }
      applyRegistry(res.data)
      for (const path of res.data.openPaths.filter((p) => p.trim())) {
        const ui = res.data.uiStateByPath[path] ?? defaultUiState()
        for (const runId of ui.openRunIds) {
          ensureController(path, runId)
        }
        if (ui.activeRunId) {
          await loadRunTranscript(path, ui.activeRunId)
        }
        void refreshRuns(path)
      }
      if (window.vyotiq.listActiveRuns) {
        const activeRes = await window.vyotiq.listActiveRuns()
        if (!cancelled && activeRes.ok) {
          setActiveRuns(activeRes.data)
          await reattachActiveRuns(activeRes.data)
        }
      }
      if (res.data.activePath) {
        const ui = res.data.uiStateByPath[res.data.activePath] ?? defaultUiState()
        const key = scrollKeyForRun(ui.activeRunId)
        const restoreTop = ui.scrollTopByRunId?.[key] ?? ui.scrollTop
        if (restoreTop > 0) {
          setScrollRestoreToken((t) => t + 1)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [applyRegistry, ensureController, loadRunTranscript, refreshRuns, reattachActiveRuns])

  useEffect(() => {
    const onBeforeUnload = (): void => {
      flushPersistUiState()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [flushPersistUiState])

  useEffect(() => {
    if (!window.vyotiq?.onChatEvent) return
    return window.vyotiq.onChatEvent((event) => {
      const workspacePath = runIdToWorkspaceRef.current.get(event.runId)
      let ctrl = controllersRef.current.get(event.runId)
      if (!ctrl && workspacePath) {
        ctrl = ensureController(workspacePath, event.runId)
      }
      if (!ctrl) {
        const buffered = eventBufferRef.current.get(event.runId) ?? []
        buffered.push(event)
        eventBufferRef.current.set(event.runId, buffered)
        return
      }
      ctrl.handleEvent(event)
    })
  }, [ensureController])

  useEffect(() => {
    if (!window.vyotiq?.onToolApprovalRequest) return
    return window.vyotiq.onToolApprovalRequest((request) => {
      const workspacePath = runIdToWorkspaceRef.current.get(request.runId)
      const ctrl =
        controllersRef.current.get(request.runId) ??
        (workspacePath ? ensureController(workspacePath, request.runId) : undefined)
      ctrl?.handleApprovalRequest(request)
    })
  }, [ensureController])

  useEffect(() => {
    void pollActiveRuns()
    const id = window.setInterval(() => void pollActiveRuns(), ACTIVE_RUNS_POLL_MS)
    const onFocus = (): void => {
      void pollActiveRuns()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
      for (const timer of orphanSyncTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      orphanSyncTimersRef.current.clear()
    }
  }, [pollActiveRuns])

  const activeWorkspace = registry?.activePath ?? null
  const openWorkspaces = registry?.openPaths ?? []
  const activeContext = activeWorkspace ? contexts[activeWorkspace] ?? null : null

  const switchWorkspace = useCallback(
    async (path: string): Promise<void> => {
      if (!window.vyotiq?.setActiveWorkspace) return
      if (activeWorkspace) flushPersistUiState(activeWorkspace)
      const res = await window.vyotiq.setActiveWorkspace(path)
      if (res.ok) {
        setWorkspaceError(null)
        applyRegistry(res.data)
        const ui = res.data.uiStateByPath[path] ?? defaultUiState()
        const key = scrollKeyForRun(ui.activeRunId)
        const restoreTop = ui.scrollTopByRunId?.[key] ?? ui.scrollTop
        if (restoreTop > 0) {
          setScrollRestoreToken((t) => t + 1)
        }
      } else {
        setWorkspaceError(res.error)
      }
    },
    [activeWorkspace, applyRegistry, flushPersistUiState]
  )

  const addWorkspace = useCallback(
    async (path?: string): Promise<void> => {
      if (!window.vyotiq?.addWorkspace) return
      const res = await window.vyotiq.addWorkspace(path)
      if (res.ok) {
        setWorkspaceError(null)
        applyRegistry(res.data)
        for (const p of res.data.openPaths) {
          setContexts((prev) => {
            if (prev[p]) return prev
            return { ...prev, [p]: contextFromRegistry(p, res.data) }
          })
          void refreshRuns(p)
        }
      } else {
        setWorkspaceError(res.error)
      }
    },
    [applyRegistry, refreshRuns]
  )

  const removeWorkspace = useCallback(
    async (path: string): Promise<void> => {
      const ctx = contexts[path]
      if (ctx) {
        for (const run of ctx.runs) {
          if (run.status === 'running') {
            backgroundRunIdsRef.current.add(run.runId)
          }
        }
        for (const runId of ctx.openRunIds) {
          const ctrl = controllersRef.current.get(runId)
          if (ctrl?.running || ctrl?.pendingRun) {
            backgroundRunIdsRef.current.add(runId)
          }
        }
        const draft = controllersRef.current.get(draftControllerKey(path))
        if (draft?.running || draft?.pendingRun) {
          const id = draft.runId
          if (id) backgroundRunIdsRef.current.add(id)
        }
      }

      flushPersistUiState(path)

      if (!window.vyotiq?.removeWorkspace) return
      const res = await window.vyotiq.removeWorkspace(path)
      if (res.ok) {
        setWorkspaceError(null)
        applyRegistry(res.data)
        setContexts((prev) => {
          const next = { ...prev }
          delete next[path]
          return next
        })
      } else {
        setWorkspaceError(res.error)
      }
    },
    [applyRegistry, contexts, flushPersistUiState]
  )

  const getRunController = useCallback(
    (runId: string | null): ChatStreamController | null => {
      if (!activeWorkspace) return null
      return ensureController(activeWorkspace, runId)
    },
    [activeWorkspace, ensureController]
  )

  const openRunTab = useCallback(
    (runId: string | null): void => {
      if (!activeWorkspace) return
      const ctx = contextsRef.current[activeWorkspace]
      if (!ctx) return
      const sameTab = ctx.activeRunId === runId
      const openRunIds =
        runId && !ctx.openRunIds.includes(runId) ? [...ctx.openRunIds, runId] : ctx.openRunIds
      const nextCtx = {
        ...ctx,
        activeRunId: runId,
        openRunIds
      }
      maybeEvictControllers(activeWorkspace, openRunIds, runId)
      ensureController(activeWorkspace, runId)
      contextsRef.current = { ...contextsRef.current, [activeWorkspace]: nextCtx }
      setContexts((prev) => ({
        ...prev,
        [activeWorkspace]: nextCtx
      }))
      schedulePersistUiState(activeWorkspace, nextCtx)
      if (!sameTab) {
        flushPersistUiState(activeWorkspace)
        setScrollRestoreToken((t) => t + 1)
      }
      bump()
    },
    [
      activeWorkspace,
      bump,
      ensureController,
      flushPersistUiState,
      maybeEvictControllers,
      schedulePersistUiState
    ]
  )

  const closeRunTab = useCallback(
    (runId: string): void => {
      if (!activeWorkspace) return
      const ctx = contextsRef.current[activeWorkspace]
      if (!ctx) return
      const ctrl = controllersRef.current.get(runId)
      if (ctrl?.running || ctrl?.pendingRun) {
        backgroundRunIdsRef.current.add(runId)
      } else {
        controllersRef.current.get(runId)?.dispose()
        controllersRef.current.delete(runId)
        const lruIdx = controllerLruRef.current.indexOf(runId)
        if (lruIdx >= 0) controllerLruRef.current.splice(lruIdx, 1)
      }
      const openRunIds = ctx.openRunIds.filter((id) => id !== runId)
      const activeRunId =
        ctx.activeRunId === runId ? openRunIds[openRunIds.length - 1] ?? null : ctx.activeRunId
      const nextCtx = { ...ctx, openRunIds, activeRunId }
      contextsRef.current = { ...contextsRef.current, [activeWorkspace]: nextCtx }
      setContexts((prev) => ({
        ...prev,
        [activeWorkspace]: nextCtx
      }))
      schedulePersistUiState(activeWorkspace, nextCtx)
      if (ctx.activeRunId === runId) {
        setScrollRestoreToken((t) => t + 1)
      }
      bump()
    },
    [activeWorkspace, bump, schedulePersistUiState]
  )

  const patchUi = useCallback(
    (path: string, patch: Partial<WorkspaceUiSlice>) => {
      setContexts((prev) => {
        const ctx = contextsRef.current[path] ?? prev[path]
        if (!ctx) return prev
        const nextCtx: WorkspaceContext = {
          ...ctx,
          ui: { ...ctx.ui, ...patch }
        }
        contextsRef.current = { ...contextsRef.current, [path]: nextCtx }
        return {
          ...prev,
          [path]: nextCtx
        }
      })
      schedulePersistUiState(path)
    },
    [schedulePersistUiState]
  )

  const setComposerDraft = useCallback(
    (draft: string) => {
      if (!activeWorkspace) return
      patchUi(activeWorkspace, { composerDraft: draft })
    },
    [activeWorkspace, patchUi]
  )

  const onMessageListScroll = useCallback(
    (scrollTop: number) => {
      if (!activeWorkspace) return
      const ctx = contextsRef.current[activeWorkspace]
      if (!ctx) return
      const key = scrollKeyForRun(ctx.activeRunId)
      if (ctx.ui.scrollTopByRunId[key] === scrollTop && ctx.ui.scrollTop === scrollTop) return
      const nextCtx: WorkspaceContext = {
        ...ctx,
        ui: {
          ...ctx.ui,
          scrollTop,
          scrollTopByRunId: { ...ctx.ui.scrollTopByRunId, [key]: scrollTop }
        }
      }
      contextsRef.current = { ...contextsRef.current, [activeWorkspace]: nextCtx }
      schedulePersistUiState(activeWorkspace, nextCtx)
    },
    [activeWorkspace, schedulePersistUiState]
  )

  const setSessionQuery = useCallback(
    (query: string): void => {
      if (!activeWorkspace) return
      setContexts((prev) => {
        const ctx = prev[activeWorkspace]
        if (!ctx) return prev
        return { ...prev, [activeWorkspace]: { ...ctx, sessionQuery: query } }
      })
    },
    [activeWorkspace]
  )

  const setSettingsOverride = useCallback(
    async (
      path: string,
      override: WorkspaceSettingsOverride | null
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!window.vyotiq?.setWorkspaceSettingsOverride) {
        return { ok: false, error: 'Workspace settings API unavailable.' }
      }
      const res = await window.vyotiq.setWorkspaceSettingsOverride(path, override)
      if (!res.ok) return { ok: false, error: res.error }
      applyRegistry(res.data)
      bump()
      return { ok: true }
    },
    [applyRegistry, bump]
  )

  const activeController = activeWorkspace
    ? ensureController(activeWorkspace, activeContext?.activeRunId ?? null)
    : null

  const subscribeActiveController = useCallback(
    (onStoreChange: () => void) => activeController?.subscribe(onStoreChange) ?? (() => {}),
    [activeController]
  )

  const getActiveControllerRevision = useCallback(
    () => activeController?.getRevision() ?? 0,
    [activeController]
  )

  useSyncExternalStore(
    subscribeActiveController,
    getActiveControllerRevision,
    getActiveControllerRevision
  )

  const chatSnapshot = activeController
    ? {
        items: activeController.items,
        messages: activeController.messages,
        running: activeController.running,
        runId: activeController.runId,
        error: activeController.error,
        runNotice: activeController.runNotice,
        incomplete: activeController.incomplete,
        contextUsage: activeController.contextUsage,
        runStartedAt: activeController.runStartedAt,
        runTerminalTick: activeController.runTerminalTick,
        pendingRun: activeController.pendingRun,
        transcriptLoading: activeController.transcriptLoading
      }
    : {
        items: [] as ChatStreamController['items'],
        messages: [] as ChatStreamController['messages'],
        running: false,
        runId: null as string | null,
        error: null as string | null,
        runNotice: null as string | null,
        incomplete: null as ChatStreamController['incomplete'],
        contextUsage: null,
        runStartedAt: null as number | null,
        runTerminalTick: 0,
        pendingRun: false,
        transcriptLoading: false
      }

  void revision

  const refreshActiveRuns = useCallback(() => {
    if (activeWorkspace) void refreshRuns(activeWorkspace)
  }, [activeWorkspace, refreshRuns])

  useEffect(() => {
    if (!activeWorkspace) return
    const timer = window.setTimeout(() => {
      void refreshRuns(activeWorkspace)
    }, LIST_RUNS_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [activeWorkspace, chatSnapshot.runTerminalTick, refreshRuns])

  const isRunActiveInBackground = useCallback(
    (runId: string): boolean => backgroundRunIdsRef.current.has(runId),
    []
  )

  const workspaceHasBackgroundRun = useCallback(
    (workspacePath: string): boolean => {
      return activeRuns.some(
        (r) =>
          workspacePathsEqual(r.workspacePath, workspacePath) &&
          (backgroundRunIdsRef.current.has(r.runId) ||
            !contexts[workspacePath]?.openRunIds.includes(r.runId))
      )
    },
    [activeRuns, contexts]
  )

  const clearRunsError = useCallback(() => {
    if (!activeWorkspace) return
    setContexts((prev) => {
      const ctx = prev[activeWorkspace]
      if (!ctx || !ctx.runsError) return prev
      return {
        ...prev,
        [activeWorkspace]: { ...ctx, runsError: null }
      }
    })
  }, [activeWorkspace])

  const clearWorkspaceError = useCallback(() => setWorkspaceError(null), [])

  const activeScrollTop = activeContext
    ? (activeContext.ui.scrollTopByRunId[scrollKeyForRun(activeContext.activeRunId)] ??
      activeContext.ui.scrollTop)
    : 0

  return {
    registry,
    activeWorkspace,
    openWorkspaces,
    activeContext,
    activeController,
    activeRuns,
    chat: chatSnapshot,
    switchWorkspace,
    addWorkspace,
    removeWorkspace,
    getRunController,
    loadRunIntoTab,
    openRunTab,
    closeRunTab,
    setSessionQuery,
    refreshActiveRuns,
    isRunActiveInBackground,
    workspaceHasBackgroundRun,
    scrollRestoreToken,
    activeScrollTop,
    workspaceError,
    clearWorkspaceError,
    clearRunsError,
    setComposerDraft,
    onMessageListScroll,
    setSettingsOverride,
    chatActions: activeController
      ? {
          send: activeController.send.bind(activeController),
          stop: activeController.stop.bind(activeController),
          reset: activeController.reset.bind(activeController),
          loadTranscript: activeController.loadTranscript.bind(activeController),
          loadToolContent: activeController.loadToolContent.bind(activeController),
          clearError: activeController.clearError.bind(activeController)
        }
      : null
  }
}
