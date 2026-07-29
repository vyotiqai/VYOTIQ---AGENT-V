import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type {
  AgentEvent,
  PersistedEvent,
  RunSummary,
  ToolApprovalRequest,
  ToolApprovalDecision,
  WorkspaceSettingsOverride,
  WorkspaceUiState,
  WorkspacesState
} from '@shared/ipc'
import { toLogErr } from '@shared/errors'
import { logger } from '@shared/logger'
import { workspacePathsEqual, findByWorkspacePath } from '@shared/workspacePathMatch'
import {
  createChatStreamController,
  type ChatStreamController
} from './createChatStreamController'
import {
  clearWorkspaceHotUi,
  getWorkspaceHotUi,
  hasWorkspaceHotUi,
  seedWorkspaceHotUi,
  setWorkspaceHotUi
} from './workspaceHotUiStore'

const ACTIVE_RUNS_POLL_MS = 5_000
const ACTIVE_RUNS_WARN_INTERVAL_MS = 60_000
const ORPHAN_SYNC_DEBOUNCE_MS = 600
const OPEN_RUN_TAB_LIMIT = 10
/** Cap orphan IPC buffers for runIds not yet mapped to a controller. */
const ORPHAN_EVENT_BUFFER_MAX = 128
const ORPHAN_APPROVAL_BUFFER_MAX = 16
/** Prefer dropping these when the orphan buffer is full — keep terminals and tool chrome. */
const ORPHAN_DROPPABLE_TYPES = new Set<AgentEvent['type']>([
  'text_delta',
  'thinking_delta',
  'step_usage',
  'context_usage'
])
const UI_PERSIST_DEBOUNCE_MS = 300
const LIST_RUNS_DEBOUNCE_MS = 300

/** @internal Exported for tests. */
export const WORKSPACE_MANAGER_LIMITS = {
  OPEN_RUN_TAB_LIMIT,
  ORPHAN_EVENT_BUFFER_MAX,
  ORPHAN_APPROVAL_BUFFER_MAX
} as const

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
  return findByWorkspacePath(overrides, path)
}

export function useWorkspaceManager() {
  const [registry, setRegistry] = useState<WorkspacesState | null>(null)
  const [contexts, setContexts] = useState<Record<string, WorkspaceContext>>({})
  const [activeRuns, setActiveRuns] = useState<{ runId: string; workspacePath: string }[]>([])
  const [revision, setRevision] = useState(0)
  const [scrollRestoreToken, setScrollRestoreToken] = useState(0)
  const [chatSurfaceEpoch, setChatSurfaceEpoch] = useState(0)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const controllersRef = useRef(new Map<string, ChatStreamController>())
  const contextsRef = useRef(contexts)
  const persistTimersRef = useRef(new Map<string, number>())
  const eventBufferRef = useRef(new Map<string, AgentEvent[]>())
  const approvalBufferRef = useRef(new Map<string, ToolApprovalRequest[]>())
  const switchReqIdRef = useRef(0)
  const runIdToWorkspaceRef = useRef(new Map<string, string>())
  /** Runs whose controller/routing was disposed; drop late events until reopened. */
  const forgottenRunIdsRef = useRef(new Set<string>())
  const controllerLruRef = useRef<string[]>([])
  const backgroundRunIdsRef = useRef(new Set<string>())
  const refreshRunsRef = useRef<(path: string) => Promise<void>>(async () => {})
  const lastActiveRunsWarnAtRef = useRef(0)
  const activeRunsRef = useRef<{ runId: string; workspacePath: string }[]>([])
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
      // Prefer ref for keystroke-hot fields so draft/query isolation is not wiped
      // when React state lags behind contextsRef.
      merged[path] = {
        ...stateCtx,
        sessionQuery: refCtx.sessionQuery,
        ui: {
          ...stateCtx.ui,
          composerDraft: refCtx.ui.composerDraft,
          scrollTop: scrollChanged ? refCtx.ui.scrollTop : stateCtx.ui.scrollTop,
          scrollTopByRunId: scrollChanged
            ? { ...stateScroll, ...refScroll }
            : stateCtx.ui.scrollTopByRunId
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

  const flushBufferedApprovals = useCallback(
    (runId: string, ctrl: ChatStreamController) => {
      const buffered = approvalBufferRef.current.get(runId)
      if (!buffered?.length) return
      approvalBufferRef.current.delete(runId)
      for (const request of buffered) ctrl.handleApprovalRequest(request)
    },
    []
  )

  const bufferOrphanEvent = useCallback((runId: string, event: AgentEvent): void => {
    if (forgottenRunIdsRef.current.has(runId)) return
    const buffered = eventBufferRef.current.get(runId) ?? []
    if (buffered.length >= ORPHAN_EVENT_BUFFER_MAX) {
      const droppableIdx = buffered.findIndex((ev) => ORPHAN_DROPPABLE_TYPES.has(ev.type))
      if (droppableIdx >= 0) buffered.splice(droppableIdx, 1)
      else buffered.shift()
    }
    buffered.push(event)
    eventBufferRef.current.set(runId, buffered)
  }, [])

  const bufferOrphanApproval = useCallback((runId: string, request: ToolApprovalRequest): void => {
    if (forgottenRunIdsRef.current.has(runId)) return
    const buffered = approvalBufferRef.current.get(runId) ?? []
    if (buffered.length >= ORPHAN_APPROVAL_BUFFER_MAX) {
      buffered.shift()
    }
    buffered.push(request)
    approvalBufferRef.current.set(runId, buffered)
  }, [])

  const forgetRunRouting = useCallback((runId: string): void => {
    forgottenRunIdsRef.current.add(runId)
    eventBufferRef.current.delete(runId)
    approvalBufferRef.current.delete(runId)
    runIdToWorkspaceRef.current.delete(runId)
    controllersRef.current.get(runId)?.dispose()
    controllersRef.current.delete(runId)
    const lruIdx = controllerLruRef.current.indexOf(runId)
    if (lruIdx >= 0) controllerLruRef.current.splice(lruIdx, 1)
  }, [])

  const touchLru = useCallback((runId: string) => {
    const lru = controllerLruRef.current
    const idx = lru.indexOf(runId)
    if (idx >= 0) lru.splice(idx, 1)
    lru.push(runId)
  }, [])

  const registerRunId = useCallback(
    (runId: string, workspacePath: string) => {
      forgottenRunIdsRef.current.delete(runId)
      runIdToWorkspaceRef.current.set(runId, workspacePath)
      touchLru(runId)
      const ctrl = controllersRef.current.get(runId)
      if (ctrl) {
        flushBufferedEvents(runId, ctrl)
        flushBufferedApprovals(runId, ctrl)
      }
    },
    [flushBufferedApprovals, flushBufferedEvents, touchLru]
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
        forgetRunRouting(candidates[i]!)
      }
    },
    [forgetRunRouting]
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
        void refreshRunsRef.current(workspacePath)
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
    async (
      workspacePath: string,
      runId: string,
      opts?: { isCurrent?: () => boolean }
    ): Promise<void> => {
      const ctrl = ensureController(workspacePath, runId)
      if (ctrl.running || ctrl.pendingRun) return
      if (!window.vyotiq?.loadRun) return
      const stillCurrent = (): boolean => {
        if (opts?.isCurrent && !opts.isCurrent()) return false
        if (ctrl.disposed) return false
        return controllersRef.current.get(runId) === ctrl
      }
      ctrl.setTranscriptLoading(true)
      try {
        const res = await window.vyotiq.loadRun(workspacePath, runId)
        if (!stillCurrent()) return
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
          if (!stillCurrent()) return
          if (eventsRes.ok) events = eventsRes.data
        }
        if (!stillCurrent()) return
        ctrl.hydrateTranscript(res.data.messages, events)
        bump()
      } finally {
        if (stillCurrent()) ctrl.setTranscriptLoading(false)
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
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    const res = await window.vyotiq.listActiveRuns()
    if (!res.ok) {
      const now = Date.now()
      if (now - lastActiveRunsWarnAtRef.current >= ACTIVE_RUNS_WARN_INTERVAL_MS) {
        lastActiveRunsWarnAtRef.current = now
        logger.warn('listActiveRuns failed', { scope: 'runs', err: toLogErr(res.error) })
      }
      return
    }
    const prevActive = activeRunsRef.current
    const nextActive = res.data
    const activeChanged =
      prevActive.length !== nextActive.length ||
      prevActive.some(
        (entry, i) =>
          entry.runId !== nextActive[i]?.runId ||
          !workspacePathsEqual(entry.workspacePath, nextActive[i]!.workspacePath)
      )
    activeRunsRef.current = nextActive
    if (activeChanged) {
      setActiveRuns(nextActive)
    }
    for (const entry of prevActive) {
      if (
        nextActive.some(
          (r) => r.runId === entry.runId && workspacePathsEqual(r.workspacePath, entry.workspacePath)
        )
      ) {
        continue
      }
      void refreshRunsRef.current(entry.workspacePath)
    }
    const activeIds = new Set(nextActive.map((entry) => entry.runId))
    await reattachActiveRuns(nextActive)
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
    if (activeChanged) bump()
  }, [reattachActiveRuns, bump])

  const applyRegistry = useCallback((state: WorkspacesState) => {
    setRegistry(state)
    setContexts((prev) => {
      const next: Record<string, WorkspaceContext> = {}
      for (const path of state.openPaths) {
        const existing = prev[path]
        if (existing) {
          const ui = state.uiStateByPath[path] ?? defaultUiState()
          const refUi = contextsRef.current[path]?.ui
          const scrollTopByRunId = { ...(ui.scrollTopByRunId ?? {}) }
          if (ui.scrollTop > 0 && ui.activeRunId && scrollTopByRunId[ui.activeRunId] === undefined) {
            scrollTopByRunId[ui.activeRunId] = ui.scrollTop
          }
          const composerDraft =
            existing.ui.composerDraft !== ''
              ? existing.ui.composerDraft
              : (refUi?.composerDraft || ui.composerDraft)
          next[path] = {
            ...existing,
            activeRunId: existing.activeRunId ?? ui.activeRunId,
            openRunIds:
              existing.openRunIds.length > 0 ? existing.openRunIds : [...ui.openRunIds],
            ui: {
              scrollTop: refUi?.scrollTop ?? existing.ui.scrollTop ?? ui.scrollTop,
              scrollTopByRunId: {
                ...scrollTopByRunId,
                ...existing.ui.scrollTopByRunId,
                ...(refUi?.scrollTopByRunId ?? {})
              },
              composerDraft
            },
            settingsOverride: findSettingsOverride(state.settingsOverridesByPath, path)
          }
        } else {
          next[path] = contextFromRegistry(path, state)
        }
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!registry) return
    const open = new Set(registry.openPaths)
    for (const path of open) {
      const ctx = contextsRef.current[path] ?? contexts[path]
      if (!ctx) continue
      if (!hasWorkspaceHotUi(path)) {
        seedWorkspaceHotUi(path, {
          composerDraft: ctx.ui.composerDraft,
          sessionQuery: ctx.sessionQuery
        })
      } else {
        // Keep store draft in sync when registry restores a non-empty draft onto an empty store path.
        const hot = getWorkspaceHotUi(path)
        if (hot.composerDraft === '' && ctx.ui.composerDraft !== '') {
          seedWorkspaceHotUi(path, {
            composerDraft: ctx.ui.composerDraft,
            sessionQuery: hot.sessionQuery || ctx.sessionQuery
          })
        }
      }
    }
    for (const path of Object.keys(contexts)) {
      if (!open.has(path)) clearWorkspaceHotUi(path)
    }
  }, [registry, contexts])

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
        if (cancelled) return
        const ui = res.data.uiStateByPath[path] ?? defaultUiState()
        for (const runId of ui.openRunIds) {
          ensureController(path, runId)
        }
        if (ui.activeRunId) {
          await loadRunTranscript(path, ui.activeRunId, {
            isCurrent: () => !cancelled
          })
        }
        if (cancelled) return
        void refreshRuns(path)
      }
      if (cancelled) return
      if (window.vyotiq.listActiveRuns) {
        const activeRes = await window.vyotiq.listActiveRuns()
        if (cancelled) return
        if (activeRes.ok) {
          setActiveRuns(activeRes.data)
          await reattachActiveRuns(activeRes.data)
        }
      }
      if (cancelled) return
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
        bufferOrphanEvent(event.runId, event)
        return
      }
      ctrl.handleEvent(event)
    })
  }, [bufferOrphanEvent, ensureController])

  useEffect(() => {
    if (!window.vyotiq?.onToolApprovalRequest) return
    return window.vyotiq.onToolApprovalRequest((request) => {
      const workspacePath = runIdToWorkspaceRef.current.get(request.runId)
      const ctrl =
        controllersRef.current.get(request.runId) ??
        (workspacePath ? ensureController(workspacePath, request.runId) : undefined)
      if (!ctrl) {
        bufferOrphanApproval(request.runId, request)
        return
      }
      ctrl.handleApprovalRequest(request)
    })
  }, [bufferOrphanApproval, ensureController])

  useEffect(() => {
    void pollActiveRuns()
    const id = window.setInterval(() => void pollActiveRuns(), ACTIVE_RUNS_POLL_MS)
    const onFocus = (): void => {
      void pollActiveRuns()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void pollActiveRuns()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
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
      const reqId = ++switchReqIdRef.current
      const res = await window.vyotiq.setActiveWorkspace(path)
      if (reqId !== switchReqIdRef.current) return
      if (res.ok) {
        setWorkspaceError(null)
        applyRegistry(res.data)
        setChatSurfaceEpoch((t) => t + 1)
        setScrollRestoreToken((t) => t + 1)
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
      const ctx = contextsRef.current[path]
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

  const openRunTabInWorkspace = useCallback(
    (workspacePath: string, runId: string | null): void => {
      const ctx = contextsRef.current[workspacePath]
      if (!ctx) return
      const sameTab = ctx.activeRunId === runId
      const openRunIds =
        runId && !ctx.openRunIds.includes(runId) ? [...ctx.openRunIds, runId] : ctx.openRunIds
      const nextCtx = {
        ...ctx,
        activeRunId: runId,
        openRunIds
      }
      maybeEvictControllers(workspacePath, openRunIds, runId)
      ensureController(workspacePath, runId)
      contextsRef.current = { ...contextsRef.current, [workspacePath]: nextCtx }
      setContexts((prev) => ({
        ...prev,
        [workspacePath]: nextCtx
      }))
      schedulePersistUiState(workspacePath, nextCtx)
      if (!sameTab) {
        flushPersistUiState(workspacePath)
        setChatSurfaceEpoch((t) => t + 1)
        setScrollRestoreToken((t) => t + 1)
      }
      bump()
    },
    [bump, ensureController, flushPersistUiState, maybeEvictControllers, schedulePersistUiState]
  )

  const openRunTab = useCallback(
    (runId: string | null): void => {
      if (!activeWorkspace) return
      openRunTabInWorkspace(activeWorkspace, runId)
    },
    [activeWorkspace, openRunTabInWorkspace]
  )

  const openRunInWorkspace = useCallback(
    async (path: string, runId: string): Promise<void> => {
      if (!activeWorkspace || !workspacePathsEqual(activeWorkspace, path)) {
        await switchWorkspace(path)
      }
      openRunTabInWorkspace(path, runId)
    },
    [activeWorkspace, openRunTabInWorkspace, switchWorkspace]
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
        forgetRunRouting(runId)
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
        setChatSurfaceEpoch((t) => t + 1)
        setScrollRestoreToken((t) => t + 1)
      }
      bump()
    },
    [activeWorkspace, bump, forgetRunRouting, schedulePersistUiState]
  )

  const setComposerDraft = useCallback(
    (draft: string) => {
      if (!activeWorkspace) return
      const ctx = contextsRef.current[activeWorkspace]
      if (!ctx) return
      if (ctx.ui.composerDraft === draft) return
      const nextCtx: WorkspaceContext = {
        ...ctx,
        ui: { ...ctx.ui, composerDraft: draft }
      }
      contextsRef.current = {
        ...contextsRef.current,
        [activeWorkspace]: nextCtx
      }
      setWorkspaceHotUi(activeWorkspace, { composerDraft: draft })
      schedulePersistUiState(activeWorkspace, nextCtx)
    },
    [activeWorkspace, schedulePersistUiState]
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
      const ctx = contextsRef.current[activeWorkspace]
      if (!ctx) return
      if (ctx.sessionQuery === query) return
      const nextCtx: WorkspaceContext = { ...ctx, sessionQuery: query }
      contextsRef.current = {
        ...contextsRef.current,
        [activeWorkspace]: nextCtx
      }
      setWorkspaceHotUi(activeWorkspace, { sessionQuery: query })
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

  const activeControllerRef = useRef(activeController)
  activeControllerRef.current = activeController

  const onLoadToolContent = useCallback(
    (toolCallId: string) =>
      activeControllerRef.current?.loadToolContent(toolCallId) ?? Promise.resolve(null),
    []
  )

  const onThinkingToggle = useCallback((messageId: string, expanded: boolean) => {
    activeControllerRef.current?.setThinkingExpanded(messageId, expanded)
  }, [])

  const onToolToggle = useCallback((toolCallId: string, expanded: boolean) => {
    activeControllerRef.current?.setToolExpanded(toolCallId, expanded)
  }, [])

  const onGroupToggle = useCallback((anchorToolCallId: string, expanded: boolean) => {
    activeControllerRef.current?.setGroupExpanded(anchorToolCallId, expanded)
  }, [])

  const onTurnToggle = useCallback((turnIndex: number) => {
    activeControllerRef.current?.toggleTurnCollapsed(turnIndex)
  }, [])

  const onApprovalDecision = useCallback(
    (requestId: string, decision: ToolApprovalDecision) =>
      activeControllerRef.current?.respondToApproval(requestId, decision) ?? Promise.resolve(),
    []
  )

  const subscribeActiveController = useCallback(
    (onStoreChange: () => void) => activeController?.subscribeMeta(onStoreChange) ?? (() => {}),
    [activeController]
  )

  const getActiveControllerRevision = useCallback(
    () => activeController?.getMetaRevision() ?? 0,
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
        transcriptLoading: activeController.transcriptLoading,
        collapsedTurnIndices: activeController.collapsedTurnIndices,
        writeCheckpoint: activeController.writeCheckpoint,
        subscribeItems: activeController.subscribeItems.bind(activeController),
        getItemsRevision: activeController.getItemsRevision.bind(activeController),
        getItems: () => activeController.items,
        subscribeMeta: activeController.subscribeMeta.bind(activeController),
        getMetaRevision: activeController.getMetaRevision.bind(activeController),
        getContextUsage: activeController.getContextUsage.bind(activeController)
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
        transcriptLoading: false,
        collapsedTurnIndices: [] as number[],
        writeCheckpoint: null as ChatStreamController['writeCheckpoint'],
        subscribeItems: (_listener: () => void) => () => {},
        getItemsRevision: () => 0,
        getItems: () => [] as ChatStreamController['items'],
        subscribeMeta: (_listener: () => void) => () => {},
        getMetaRevision: () => 0,
        getContextUsage: () => null
      }

  const collapsedTurns = useMemo(
    () =>
      chatSnapshot.collapsedTurnIndices.length > 0
        ? new Set(chatSnapshot.collapsedTurnIndices)
        : undefined,
    [chatSnapshot.collapsedTurnIndices]
  )

  void revision

  const refreshActiveRuns = useCallback(() => {
    if (activeWorkspace) void refreshRuns(activeWorkspace)
  }, [activeWorkspace, refreshRuns])

  const refreshWorkspaceRuns = useCallback(
    (workspacePath: string): void => {
      void refreshRuns(workspacePath)
    },
    [refreshRuns]
  )

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

  const clearRunsError = useCallback((workspacePath?: string) => {
    const path = workspacePath ?? activeWorkspace
    if (!path) return
    setContexts((prev) => {
      const ctx = prev[path]
      if (!ctx || !ctx.runsError) return prev
      return {
        ...prev,
        [path]: { ...ctx, runsError: null }
      }
    })
  }, [activeWorkspace])

  const clearWorkspaceError = useCallback(() => setWorkspaceError(null), [])

  const activeScrollTop = activeContext
    ? (activeContext.ui.scrollTopByRunId[scrollKeyForRun(activeContext.activeRunId)] ??
      activeContext.ui.scrollTop)
    : 0

  const chatActions = useMemo(
    () =>
      activeController
        ? {
            send: activeController.send.bind(activeController),
            stop: activeController.stop.bind(activeController),
            reset: activeController.reset.bind(activeController),
            loadTranscript: activeController.loadTranscript.bind(activeController),
            loadToolContent: activeController.loadToolContent.bind(activeController),
            clearError: activeController.clearError.bind(activeController),
            applyManualCompaction: activeController.applyManualCompaction.bind(activeController),
            markWriteCheckpointUndone:
              activeController.markWriteCheckpointUndone.bind(activeController)
          }
        : null,
    [activeController]
  )

  return {
    registry,
    activeWorkspace,
    openWorkspaces,
    activeContext,
    contexts,
    activeController,
    activeRuns,
    chat: chatSnapshot,
    switchWorkspace,
    addWorkspace,
    removeWorkspace,
    getRunController,
    loadRunIntoTab,
    openRunTab,
    openRunInWorkspace,
    closeRunTab,
    setSessionQuery,
    refreshActiveRuns,
    refreshWorkspaceRuns,
    isRunActiveInBackground,
    workspaceHasBackgroundRun,
    scrollRestoreToken,
    chatSurfaceEpoch,
    activeScrollTop,
    workspaceError,
    clearWorkspaceError,
    clearRunsError,
    setComposerDraft,
    onMessageListScroll,
    setSettingsOverride,
    onLoadToolContent,
    onThinkingToggle,
    onToolToggle,
    onGroupToggle,
    onTurnToggle,
    onApprovalDecision,
    collapsedTurns,
    chatActions
  }
}
