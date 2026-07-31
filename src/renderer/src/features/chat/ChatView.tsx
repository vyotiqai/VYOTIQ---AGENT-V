import type { Ref } from 'react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MessageList } from './components/MessageList'
import { AgentBrowserPanel } from './components/AgentBrowserPanel'
import { ChangesPanel } from './components/ChangesPanel'
import { PlanPanel } from './components/PlanPanel'
import { PrPanel } from './components/PrPanel'
import { ChatSideRail } from './components/ChatSideRail'
import { DockTabBar, AGENT_DOCK_TAB, defaultDockTab } from './components/DockTabBar'
import { TerminalPanel } from './components/TerminalPanel'
import { isPlanDraftReady } from './components/composer/PlanHandoff'
import { Composer } from './components/composer'
import { RunSessionProvider } from './RunSessionContext'
import {
  ChatGitLeading,
  ChatGitTrailing,
  useChatLiveItems,
  useGitRevision,
  useHasChatItems
} from './components/ChatStreamLeaves'
import { useGitChrome } from './components/GitChrome'
import type { UiAgentQuestionAnswer, UiItem } from '@shared/transcript'
import type { AgentInteractionMode, ProviderId, ToolApprovalDecision } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { Alert, PanelResizeHandle } from '@renderer/lib/ui'
import { usePersistedBoolean } from '@renderer/lib/hooks/usePersistedBoolean'
import { usePersistedNumber } from '@renderer/lib/hooks/usePersistedNumber'
import { useTitleBarAccessory } from '@renderer/lib/context/TitleBarAccessory'
import {
  BROWSER_PANEL_OPEN_KEY,
  CHAT_COLUMN_MAX,
  CHAT_GUTTER,
  CHAT_RIGHT_PANEL,
  CHAT_STAGE_INSET,
  COMPOSER_DOCK_CLEARANCE_PX,
  COMPOSER_DOCK_FADE_PX,
  COMPOSER_DOCK_FALLBACK_PX,
  DOCK_EXPANDED_KEY,
  DOCK_WIDTH_DEFAULT_PX,
  DOCK_WIDTH_KEY,
  DOCK_WIDTH_MAX_PX,
  DOCK_WIDTH_MIN_PX,
  IMMERSIVE_TAB_KEY,
  RIGHT_PANEL_KEY,
  clampDockWidthPx,
  type ChatRightPanelId,
  type DockImmersiveTabId
} from '@renderer/lib/utils/layout'
import { cn } from '@renderer/lib/ui/cn'
import type { ChatItemsStore, ChatMetaStore } from './chatStores'

export type { ChatItemsStore, ChatMetaStore } from './chatStores'

const MemoComposer = memo(Composer)

function TranscriptPane({
  items,
  pendingRun,
  running,
  transcriptLoading,
  dockReservePx,
  restoreScrollTop,
  scrollRestoreToken,
  onScrollTopChange,
  onLoadToolContent,
  onThinkingToggle,
  onToolToggle,
  onGroupToggle,
  onTurnToggle,
  onApprovalDecision,
  onQuestionSubmit,
  collapsedTurns,
  showThinking,
  mcpServerNames,
  surfaceKey,
  workspacePath,
  activeRunId,
  agentMode,
  canUndoWrites,
  undoBusy,
  onUndoWrites,
  writeFileResolutions,
  writeResolvablePaths,
  onKeepWriteFile,
  onDiscardWriteFile,
  onKeepAllWrites,
  resolveBlockedReason,
  onOpenChanges,
  sideRailPad = true
}: {
  items: UiItem[]
  pendingRun?: boolean
  running: boolean
  transcriptLoading?: boolean
  dockReservePx: number
  restoreScrollTop?: number
  scrollRestoreToken?: number
  onScrollTopChange?: (scrollTop: number) => void
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onThinkingToggle?: (messageId: string, expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onGroupToggle?: (anchorToolCallId: string, expanded: boolean) => void
  onTurnToggle?: (turnIndex: number) => void
  onApprovalDecision?: (requestId: string, decision: ToolApprovalDecision) => void | Promise<void>
  onQuestionSubmit?: (requestId: string, answers: UiAgentQuestionAnswer[]) => void | Promise<void>
  collapsedTurns?: ReadonlySet<number>
  showThinking?: boolean
  mcpServerNames?: ReadonlyMap<string, string>
  surfaceKey: string
  workspacePath: string | null
  activeRunId: string | null
  agentMode?: AgentInteractionMode
  canUndoWrites?: boolean
  undoBusy?: boolean
  onUndoWrites?: () => void | Promise<unknown>
  writeFileResolutions?: ReadonlyMap<string, 'kept' | 'discarded' | undefined>
  writeResolvablePaths?: ReadonlySet<string>
  onKeepWriteFile?: (path: string) => void | Promise<unknown>
  onDiscardWriteFile?: (path: string) => void | Promise<unknown>
  onKeepAllWrites?: () => void | Promise<unknown>
  resolveBlockedReason?: string | null
  onOpenChanges?: () => void
  sideRailPad?: boolean
}) {
  const runSession = useMemo(
    () => ({
      workspacePath: workspacePath ?? null,
      runId: activeRunId ?? null,
      agentMode
    }),
    [workspacePath, activeRunId, agentMode]
  )
  return (
    <RunSessionProvider value={runSession}>
      <MessageList
        key={`transcript:${surfaceKey}`}
        items={items}
        pendingRun={pendingRun}
        running={running}
        transcriptLoading={transcriptLoading}
        reserveComposerSpace
        dockReservePx={dockReservePx}
        restoreScrollTop={restoreScrollTop}
        scrollRestoreToken={scrollRestoreToken}
        onScrollTopChange={onScrollTopChange}
        onLoadToolContent={onLoadToolContent}
        onThinkingToggle={onThinkingToggle}
        onToolToggle={onToolToggle}
        onGroupToggle={onGroupToggle}
        onTurnToggle={onTurnToggle}
        onApprovalDecision={onApprovalDecision}
        onQuestionSubmit={onQuestionSubmit}
        collapsedTurns={collapsedTurns}
        showThinking={showThinking}
        mcpServerNames={mcpServerNames}
        canUndoWrites={canUndoWrites}
        undoBusy={undoBusy}
        onUndoWrites={onUndoWrites}
        writeFileResolutions={writeFileResolutions}
        writeResolvablePaths={writeResolvablePaths}
        onKeepWriteFile={onKeepWriteFile}
        onDiscardWriteFile={onDiscardWriteFile}
        onKeepAllWrites={onKeepAllWrites}
        resolveBlockedReason={resolveBlockedReason}
        onOpenChanges={onOpenChanges}
        sideRailPad={sideRailPad}
      />
    </RunSessionProvider>
  )
}

export function ChatView({
  items,
  itemsStore,
  metaStore,
  running,
  pendingRun = false,
  error,
  runNotice,
  incomplete,
  onContinue,
  contextUsage,
  onCompactContext,
  operationalError,
  hasWorkspace,
  workspacePath,
  provider,
  model,
  ollamaBaseUrl,
  modelsRefreshKey,
  activeRunId,
  transcriptLoading,
  headingRef,
  onProviderModel,
  favoriteModels = [],
  recentModels = [],
  serviceTier = 'default',
  onToggleFavorite = () => {},
  onServiceTierChange = () => {},
  chatSettings,
  onChatSettingsChange,
  agentMode = 'agent',
  onAgentModeChange = () => {},
  onContinueInAgent,
  onSend,
  onStop,
  pendingFollowUps = [],
  onRemoveFollowUp,
  onDismissError,
  composerDraft,
  onComposerDraftChange,
  restoreScrollTop,
  scrollRestoreToken,
  onScrollTopChange,
  onLoadToolContent,
  onThinkingToggle,
  onToolToggle,
  onGroupToggle,
  onTurnToggle,
  onApprovalDecision,
  onQuestionSubmit,
  collapsedTurns,
  showThinking = true,
  chatSurfaceEpoch = 0,
  mcpServerNames,
  slashHandlers,
  canUndoWrites = false,
  undoBusy = false,
  onUndoWrites,
  writeFileResolutions,
  writeResolvablePaths,
  onKeepWriteFile,
  onDiscardWriteFile,
  onKeepAllWrites,
  resolveBlockedReason = null
}: {
  items: UiItem[]
  /** When set, transcript leaves subscribe so ChatView/Composer skip token patches. */
  itemsStore?: ChatItemsStore
  /** When set, ContextMeter reads usage via meta store (skips prop fanout). */
  metaStore?: ChatMetaStore
  running: boolean
  pendingRun?: boolean
  error: string | null
  runNotice?: string | null
  incomplete?: import('@renderer/lib/hooks/createChatStreamController').IncompleteTurnState | null
  onContinue?: () => void
  contextUsage?: import('./components/composer/ContextMeter').ContextUsageState | null
  onCompactContext?: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>
  operationalError?: string | null
  hasWorkspace: boolean
  workspacePath: string | null
  provider: ProviderId
  model: string
  ollamaBaseUrl?: string
  modelsRefreshKey?: string | number
  activeRunId: string | null
  transcriptLoading?: boolean
  headingRef?: Ref<HTMLHeadingElement>
  onProviderModel: (provider: ProviderId, model: string) => void
  favoriteModels?: string[]
  recentModels?: string[]
  serviceTier?: import('@shared/ipc').ServiceTier
  onToggleFavorite?: (provider: ProviderId, model: string) => void
  onServiceTierChange?: (tier: import('@shared/ipc').ServiceTier) => void
  chatSettings: EffectiveChatSettings
  onChatSettingsChange: (patch: ChatSettingsPatch) => void
  agentMode?: AgentInteractionMode
  onAgentModeChange?: (mode: AgentInteractionMode) => void
  onContinueInAgent?: () => void
  onSend: (
    text: string,
    images?: string[],
    files?: import('@shared/ipc').AttachedFile[],
    extras?: import('@shared/ipc').ComposerSendExtras
  ) => boolean | void | Promise<boolean | void>
  onStop: () => void
  pendingFollowUps?: import('@renderer/lib/hooks/createChatStreamController').PendingFollowUpState[]
  onRemoveFollowUp?: (id: string) => void
  onDismissError?: () => void
  composerDraft?: string
  onComposerDraftChange?: (draft: string) => void
  restoreScrollTop?: number
  scrollRestoreToken?: number
  onScrollTopChange?: (scrollTop: number) => void
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onThinkingToggle?: (messageId: string, expanded: boolean) => void
  onToolToggle?: (toolCallId: string, expanded: boolean) => void
  onGroupToggle?: (anchorToolCallId: string, expanded: boolean) => void
  onTurnToggle?: (turnIndex: number) => void
  onApprovalDecision?: (requestId: string, decision: ToolApprovalDecision) => void | Promise<void>
  onQuestionSubmit?: (requestId: string, answers: UiAgentQuestionAnswer[]) => void | Promise<void>
  collapsedTurns?: ReadonlySet<number>
  showThinking?: boolean
  mcpServerNames?: ReadonlyMap<string, string>
  /**
   * Bumps on workspace / run-tab switches (not draft→run id assignment) so the
   * transcript and composer remount without clearing mid-send attachments.
   */
  chatSurfaceEpoch?: number
  slashHandlers?: import('./components/composer/slashCommandExecute').SlashClientHandlers
  canUndoWrites?: boolean
  undoBusy?: boolean
  onUndoWrites?: () => void | Promise<unknown>
  writeFileResolutions?: ReadonlyMap<string, 'kept' | 'discarded' | undefined>
  writeResolvablePaths?: ReadonlySet<string>
  onKeepWriteFile?: (path: string) => void | Promise<unknown>
  onDiscardWriteFile?: (path: string) => void | Promise<unknown>
  onKeepAllWrites?: () => void | Promise<unknown>
  resolveBlockedReason?: string | null
}) {
  // Boolean presence only — stays Object.is-stable across pure text_delta frames.
  const hasItems = useHasChatItems(itemsStore, items)
  const bannerError = operationalError ?? error
  const showHero = !hasItems && !activeRunId && !transcriptLoading
  const surfaceKey = `${workspacePath ?? 'none'}:${chatSurfaceEpoch}`
  const stageRef = useRef<HTMLDivElement>(null)
  const [dockReservePx, setDockReservePx] = useState(COMPOSER_DOCK_FALLBACK_PX)
  const [activeRightPanel, setActiveRightPanel] = useState<ChatRightPanelId | null>(() => {
    try {
      const raw = localStorage.getItem(RIGHT_PANEL_KEY)
      if (
        raw === 'browser' ||
        raw === 'terminal' ||
        raw === 'changes' ||
        raw === 'plan' ||
        raw === 'pr'
      ) {
        return raw
      }
      // Legacy Files rail → Changes (list + Keep/Discard in one panel).
      if (raw === 'files') return 'changes'
      // Migrate legacy browser-open preference.
      const legacy = localStorage.getItem(BROWSER_PANEL_OPEN_KEY)
      if (legacy === '1' || legacy === 'true') return 'browser'
    } catch {
      /* ignore */
    }
    return null
  })
  const [prNumber, setPrNumber] = useState<number | null>(null)
  /** Accumulated dock title tabs (multi-panel strip). */
  const [dockTabs, setDockTabs] = useState<ChatRightPanelId[]>(() =>
    activeRightPanel ? [activeRightPanel] : []
  )
  /** Keep panels mounted (hidden) when switching so PTY/browser state survives. */
  const [mountedPanels, setMountedPanels] = useState<ChatRightPanelId[]>(() =>
    activeRightPanel ? [activeRightPanel] : []
  )
  const [dockWidthPx, setDockWidthPx] = usePersistedNumber(
    DOCK_WIDTH_KEY,
    DOCK_WIDTH_DEFAULT_PX,
    clampDockWidthPx
  )
  /** Immersive unified tabs (Expand panel) — not a wider side dock. */
  const [dockExpanded, setDockExpanded] = usePersistedBoolean(DOCK_EXPANDED_KEY, false)
  const [immersiveTab, setImmersiveTabState] = useState<DockImmersiveTabId>(() => {
    try {
      const raw = localStorage.getItem(IMMERSIVE_TAB_KEY)
      if (
        raw === 'agent' ||
        raw === 'browser' ||
        raw === 'terminal' ||
        raw === 'changes' ||
        raw === 'plan' ||
        raw === 'pr'
      ) {
        return raw
      }
    } catch {
      /* ignore */
    }
    return activeRightPanel ?? 'agent'
  })
  const setImmersiveTab = useCallback((next: DockImmersiveTabId | ((prev: DockImmersiveTabId) => DockImmersiveTabId)) => {
    setImmersiveTabState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      try {
        localStorage.setItem(IMMERSIVE_TAB_KEY, resolved)
      } catch {
        /* ignore */
      }
      return resolved
    })
  }, [])
  const dockMaxPx = clampDockWidthPx(DOCK_WIDTH_MAX_PX)
  const dockImmersive = dockExpanded && dockTabs.length > 0
  const { host: titleBarHost, setOccupied: setTitleBarOccupied } = useTitleBarAccessory()

  useLayoutEffect(() => {
    setTitleBarOccupied(dockImmersive)
    return () => setTitleBarOccupied(false)
  }, [dockImmersive, setTitleBarOccupied])

  /** Session-scoped: skip auto-open after the user closes a panel until they open it again. */
  const dismissedPanelsRef = useRef<Set<ChatRightPanelId>>(new Set())
  const wasChangesActiveRef = useRef(false)
  const liveItems = useChatLiveItems(itemsStore, items)
  const [gitRevision, bumpGitRevision] = useGitRevision(workspacePath, running, liveItems)
  const gitChrome = useGitChrome(workspacePath, gitRevision, Boolean(workspacePath))
  const notifyGitMutated = useCallback(() => {
    gitChrome.refresh()
    bumpGitRevision()
  }, [gitChrome, bumpGitRevision])

  const keepWriteFile = useCallback(
    async (path: string) => {
      const ok = await onKeepWriteFile?.(path)
      if (ok !== false) notifyGitMutated()
    },
    [onKeepWriteFile, notifyGitMutated]
  )
  const discardWriteFile = useCallback(
    async (path: string) => {
      const ok = await onDiscardWriteFile?.(path)
      if (ok !== false) notifyGitMutated()
    },
    [onDiscardWriteFile, notifyGitMutated]
  )
  const keepAllWrites = useCallback(async () => {
    const ok = await onKeepAllWrites?.()
    if (ok !== false) notifyGitMutated()
  }, [onKeepAllWrites, notifyGitMutated])
  const discardAllWrites = useCallback(async () => {
    const ok = await onUndoWrites?.()
    if (ok !== false) notifyGitMutated()
  }, [onUndoWrites, notifyGitMutated])

  // Prefer the shared mutating-tool revision (same clock as composer chrome), not
  // a per-done-tool + fileCount formula that over-fetches and races the status cache.
  const [changesPreferredScope, setChangesPreferredScope] = useState<'agent' | 'uncommitted'>(
    'uncommitted'
  )
  const [changesScopeToken, setChangesScopeToken] = useState(0)

  const agentTerminalRunning = useMemo(
    () =>
      liveItems.some(
        (item) =>
          item.kind === 'tool' &&
          item.tool.name === 'terminal' &&
          item.tool.status === 'running'
      ),
    [liveItems]
  )

  const persistRightPanel = useCallback((next: ChatRightPanelId | null) => {
    try {
      if (next) localStorage.setItem(RIGHT_PANEL_KEY, next)
      else localStorage.removeItem(RIGHT_PANEL_KEY)
      localStorage.setItem(BROWSER_PANEL_OPEN_KEY, next === 'browser' ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const closeDock = useCallback(() => {
    setActiveRightPanel((current) => {
      if (current) dismissedPanelsRef.current.add(current)
      return null
    })
    setDockExpanded(false)
    setImmersiveTab('agent')
    // Keep mountedPanels/dockTabs so PTY/browser/plan state survives hide; clear
    // only when the last tab is closed via closeDockTab.
    persistRightPanel(null)
  }, [persistRightPanel, setDockExpanded])

  const setRightPanel = useCallback(
    (next: ChatRightPanelId | null) => {
      if (next === null) {
        closeDock()
        return
      }
      dismissedPanelsRef.current.delete(next)
      setActiveRightPanel(next)
      setDockTabs((prev) => (prev.includes(next) ? prev : [...prev, next]))
      setMountedPanels((prev) => (prev.includes(next) ? prev : [...prev, next]))
      setImmersiveTab(next)
      persistRightPanel(next)
    },
    [closeDock, persistRightPanel]
  )

  const openChangesPanel = useCallback(
    (scope: 'agent' | 'uncommitted' = 'uncommitted') => {
      setChangesPreferredScope(scope)
      setChangesScopeToken((n) => n + 1)
      setRightPanel('changes')
    },
    [setRightPanel]
  )

  const activeRightPanelRef = useRef(activeRightPanel)
  activeRightPanelRef.current = activeRightPanel

  const tryAutoOpenPanel = useCallback(
    (panel: ChatRightPanelId) => {
      if (dismissedPanelsRef.current.has(panel)) return
      setDockTabs((prev) => (prev.includes(panel) ? prev : [...prev, panel]))
      setMountedPanels((prev) => (prev.includes(panel) ? prev : [...prev, panel]))
      const current = activeRightPanelRef.current
      if (
        current === panel ||
        current === 'browser' ||
        current === 'terminal' ||
        current === 'changes' ||
        current === 'plan' ||
        current === 'pr'
      ) {
        // Already open or another panel focused — add the tab but do not steal focus.
        return
      }
      setActiveRightPanel(panel)
      setImmersiveTab(panel)
      persistRightPanel(panel)
    },
    [persistRightPanel, setImmersiveTab]
  )

  const closeDockTab = useCallback(
    (id: ChatRightPanelId) => {
      dismissedPanelsRef.current.add(id)
      setDockTabs((prev) => {
        const next = prev.filter((t) => t !== id)
        setMountedPanels((mounted) => mounted.filter((t) => t !== id))
        if (next.length === 0) {
          setActiveRightPanel(null)
          setDockExpanded(false)
          setImmersiveTab('agent')
          persistRightPanel(null)
          return []
        }
        setActiveRightPanel((active) => {
          if (active !== id) return active
          const fallback = next[next.length - 1] ?? null
          persistRightPanel(fallback)
          return fallback
        })
        setImmersiveTab((tab) => {
          if (tab !== id) return tab
          return next[next.length - 1] ?? 'agent'
        })
        return next
      })
    },
    [persistRightPanel, setDockExpanded]
  )

  const toggleRightPanel = useCallback(
    (panel: ChatRightPanelId) => {
      if (activeRightPanel === panel) {
        closeDockTab(panel)
        return
      }
      setRightPanel(panel)
    },
    [activeRightPanel, closeDockTab, setRightPanel]
  )

  const toggleDockExpanded = useCallback(() => {
    if (dockExpanded) {
      // Collapse: if Agent is focused, return to full chat (no side dock); else side dock.
      if (immersiveTab === 'agent') {
        setActiveRightPanel(null)
        persistRightPanel(null)
      }
      setDockExpanded(false)
      return
    }
    if (activeRightPanel) {
      setImmersiveTab(activeRightPanel)
      setDockExpanded(true)
      return
    }
    // Re-expand after collapsing from Agent while dock tabs remain mounted in state.
    if (dockTabs.length > 0) {
      setImmersiveTab((tab) => (tab === 'agent' ? 'agent' : tab))
      setDockExpanded(true)
    }
  }, [
    activeRightPanel,
    dockExpanded,
    dockTabs.length,
    immersiveTab,
    persistRightPanel,
    setDockExpanded,
    setImmersiveTab
  ])

  const selectImmersiveTab = useCallback(
    (id: DockImmersiveTabId) => {
      setImmersiveTab(id)
      if (id !== 'agent') {
        setRightPanel(id)
      }
    },
    [setImmersiveTab, setRightPanel]
  )

  useEffect(() => {
    const onResize = (): void => {
      setDockWidthPx((w) => clampDockWidthPx(w))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [setDockWidthPx])

  // Drop immersive only when the dock has no panels left (not merely Agent-focused).
  useEffect(() => {
    if (!activeRightPanel && dockTabs.length === 0) setDockExpanded(false)
  }, [activeRightPanel, dockTabs.length, setDockExpanded])

  useEffect(() => {
    setPrNumber(null)
    wasChangesActiveRef.current = false
    dismissedPanelsRef.current.clear()
  }, [workspacePath])

  useEffect(() => {
    let cancelled = false
    let wasOpen = false
    void window.vyotiq?.browserGetState?.().then((res) => {
      if (cancelled || !res.ok) return
      wasOpen = Boolean(res.data.open)
    })
    const unsub = window.vyotiq?.onBrowserState?.((next) => {
      if (cancelled) return
      const open = Boolean(next.open)
      if (open && !wasOpen) {
        tryAutoOpenPanel('browser')
      }
      wasOpen = open
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [tryAutoOpenPanel])

  // Auto-open Changes on rising edge of dirty git / unresolved writes
  useEffect(() => {
    if (!workspacePath) {
      wasChangesActiveRef.current = false
      return
    }
    const dirty = Boolean(gitChrome.status && gitChrome.status.fileCount > 0)
    const unresolved = Boolean(canUndoWrites && writeResolvablePaths && writeResolvablePaths.size > 0)
    const next = dirty || unresolved
    if (next && !wasChangesActiveRef.current) {
      tryAutoOpenPanel('changes')
    }
    wasChangesActiveRef.current = next
  }, [
    workspacePath,
    gitChrome.status,
    canUndoWrites,
    writeResolvablePaths,
    tryAutoOpenPanel
  ])

  const handlePrMeta = useCallback((meta: { number: number; title: string } | null) => {
    setPrNumber(meta?.number ?? null)
  }, [])

  // Auto-open plan panel when plan.md is ready in plan mode (single check;
  // PlanPanel owns polling while the tab is mounted).
  useEffect(() => {
    if (!workspacePath || !activeRunId || agentMode !== 'plan') {
      return
    }
    let cancelled = false
    void window.vyotiq.readRunArtifact?.({ workspacePath, runId: activeRunId, name: 'plan.md' }).then(
      (res) => {
        if (cancelled) return
        const ready = Boolean(res.ok && isPlanDraftReady(res.data?.content))
        if (ready) {
          tryAutoOpenPanel('plan')
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [workspacePath, activeRunId, running, agentMode, tryAutoOpenPanel])

  // Auto-open terminal panel when the agent starts a terminal tool
  useEffect(() => {
    if (!agentTerminalRunning) return
    tryAutoOpenPanel('terminal')
  }, [agentTerminalRunning, tryAutoOpenPanel])

  const tabItems = useMemo(
    () => dockTabs.map((id) => defaultDockTab(id, id === 'pr' ? prNumber : null)),
    [dockTabs, prNumber]
  )
  const immersiveTabItems = useMemo(() => [AGENT_DOCK_TAB, ...tabItems], [tabItems])
  const visiblePanelId: ChatRightPanelId | null = dockImmersive
    ? immersiveTab === 'agent'
      ? null
      : immersiveTab
    : activeRightPanel
  // Pad only while the floating side rail is mounted (hidden when a side dock
  // is open or in immersive unified-tabs mode).
  const agentSideRailPad = !dockImmersive && activeRightPanel == null

  // Transcript scrolls behind the floating composer, so it has to reserve the
  // dock height plus the fade painted above it (not included in offsetHeight).
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const dock = stage.querySelector<HTMLElement>('[data-composer-dock]')
    if (!dock) return undefined

    const sync = (): void => {
      const dockH =
        Math.max(dock.offsetHeight, 48) + COMPOSER_DOCK_FADE_PX + COMPOSER_DOCK_CLEARANCE_PX
      stage.style.setProperty('--vy-dock-h', `${dockH}px`)
      setDockReservePx(dockH)
    }

    sync()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(sync)
    ro.observe(dock)
    const shell = dock.querySelector('[data-composer-shell]')
    if (shell) ro.observe(shell)
    return () => ro.disconnect()
  }, [showHero, surfaceKey, dockImmersive, immersiveTab])

  const composerProps = {
    provider,
    model,
    running,
    disabled: !hasWorkspace,
    hasTranscript: liveItems.some(
      (item) =>
        (item.kind === 'message' && item.role === 'assistant') || item.kind === 'tool'
    ),
    hasWorkspace,
    ollamaBaseUrl,
    modelsRefreshKey,
    draft: composerDraft,
    onDraftChange: onComposerDraftChange,
    workspacePath,
    onProviderModel,
    favoriteModels,
    recentModels,
    serviceTier,
    onToggleFavorite,
    onServiceTierChange,
    chatSettings,
    onChatSettingsChange,
    agentMode,
    onAgentModeChange,
    onSend,
    onStop,
    pendingFollowUps,
    onRemoveFollowUp,
    runNotice,
    incomplete,
    onContinue,
    onContinueInAgent,
    activeRunId,
    contextUsage: metaStore ? undefined : contextUsage,
    metaStore,
    onCompactContext,
    slashHandlers,
    sideRailPad: agentSideRailPad
  }

  const agentColumn = (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">
        Vyotiq chat
      </h1>

      {showHero ? (
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col items-center justify-center',
            agentSideRailPad ? CHAT_STAGE_INSET : CHAT_GUTTER
          )}
          role="status"
        >
          {bannerError ? (
            <Alert
              className={cn('mb-4 w-full', CHAT_COLUMN_MAX)}
              onDismiss={onDismissError}
            >
              {bannerError}
            </Alert>
          ) : null}
          <div
            className={cn(
              'flex w-full flex-col items-center gap-3 animate-fade-in',
              CHAT_COLUMN_MAX
            )}
            data-composer-hero
          >
            <MemoComposer
              key={`composer:${surfaceKey}`}
              {...composerProps}
              variant="hero"
              className="w-full"
            />
          </div>
        </div>
      ) : (
        <div ref={stageRef} className="relative flex min-h-0 flex-1 flex-col" data-chat-stage>
          <TranscriptPane
            items={liveItems}
            pendingRun={pendingRun}
            running={running}
            transcriptLoading={transcriptLoading}
            dockReservePx={dockReservePx}
            restoreScrollTop={restoreScrollTop}
            scrollRestoreToken={scrollRestoreToken}
            onScrollTopChange={onScrollTopChange}
            onLoadToolContent={onLoadToolContent}
            onThinkingToggle={onThinkingToggle}
            onToolToggle={onToolToggle}
            onGroupToggle={onGroupToggle}
            onTurnToggle={onTurnToggle}
            onApprovalDecision={onApprovalDecision}
            onQuestionSubmit={onQuestionSubmit}
            collapsedTurns={collapsedTurns}
            showThinking={showThinking}
            mcpServerNames={mcpServerNames}
            surfaceKey={surfaceKey}
            workspacePath={workspacePath}
            activeRunId={activeRunId}
            agentMode={agentMode}
            canUndoWrites={canUndoWrites}
            undoBusy={undoBusy}
            onUndoWrites={onUndoWrites}
            writeFileResolutions={writeFileResolutions}
            writeResolvablePaths={writeResolvablePaths}
            onKeepWriteFile={onKeepWriteFile}
            onDiscardWriteFile={onDiscardWriteFile}
            onKeepAllWrites={onKeepAllWrites}
            resolveBlockedReason={resolveBlockedReason}
            onOpenChanges={() => openChangesPanel('agent')}
            sideRailPad={agentSideRailPad}
          />

          <MemoComposer
            key={`composer:${surfaceKey}`}
            {...composerProps}
            variant="dock"
            bannerError={bannerError}
            onDismissError={onDismissError}
            leading={
              <ChatGitLeading chrome={gitChrome} onOpenChanges={() => openChangesPanel('uncommitted')} />
            }
            trailing={
              <ChatGitTrailing chrome={gitChrome} />
            }
          />
        </div>
      )}
    </>
  )

  const panelBodies = (
    <>
      {mountedPanels.includes('browser') ? (
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
            visiblePanelId === 'browser' ? 'flex' : 'hidden'
          )}
          aria-hidden={visiblePanelId !== 'browser'}
          inert={visiblePanelId !== 'browser' ? true : undefined}
        >
          <AgentBrowserPanel
            workspacePath={workspacePath}
            activeRunId={activeRunId}
            visible={visiblePanelId === 'browser'}
            onClose={() => closeDockTab('browser')}
          />
        </div>
      ) : null}
      {mountedPanels.includes('terminal') ? (
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
            visiblePanelId === 'terminal' ? 'flex' : 'hidden'
          )}
          aria-hidden={visiblePanelId !== 'terminal'}
          inert={visiblePanelId !== 'terminal' ? true : undefined}
        >
          <TerminalPanel
            workspacePath={workspacePath}
            visible={visiblePanelId === 'terminal'}
          />
        </div>
      ) : null}
      {mountedPanels.includes('changes') ? (
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
            visiblePanelId === 'changes' ? 'flex' : 'hidden'
          )}
          aria-hidden={visiblePanelId !== 'changes'}
          inert={visiblePanelId !== 'changes' ? true : undefined}
        >
          <ChangesPanel
            items={liveItems}
            workspacePath={workspacePath}
            gitRevision={gitRevision}
            chrome={gitChrome}
            onGitMutated={notifyGitMutated}
            onViewPr={() => setRightPanel('pr')}
            writeFileResolutions={writeFileResolutions}
            resolvablePaths={writeResolvablePaths}
            canResolve={canUndoWrites}
            resolveBusy={undoBusy}
            resolveBlockedReason={resolveBlockedReason}
            onKeepWriteFile={keepWriteFile}
            onDiscardWriteFile={discardWriteFile}
            onKeepAllWrites={keepAllWrites}
            onDiscardAllWrites={discardAllWrites}
            active={visiblePanelId === 'changes'}
            preferredScope={changesPreferredScope}
            preferredScopeToken={changesScopeToken}
          />
        </div>
      ) : null}
      {mountedPanels.includes('pr') ? (
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
            visiblePanelId === 'pr' ? 'flex' : 'hidden'
          )}
          aria-hidden={visiblePanelId !== 'pr'}
          inert={visiblePanelId !== 'pr' ? true : undefined}
        >
          <PrPanel
            workspacePath={workspacePath}
            gitRevision={gitRevision}
            onPrMeta={handlePrMeta}
            onUnlink={() => closeDockTab('pr')}
            active={visiblePanelId === 'pr'}
          />
        </div>
      ) : null}
      {mountedPanels.includes('plan') ? (
        <div
          className={cn(
            'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
            visiblePanelId === 'plan' ? 'flex' : 'hidden'
          )}
          aria-hidden={visiblePanelId !== 'plan'}
          inert={visiblePanelId !== 'plan' ? true : undefined}
        >
          <PlanPanel
            workspacePath={workspacePath}
            runId={activeRunId}
            running={running}
            active={visiblePanelId === 'plan'}
          />
        </div>
      ) : null}
    </>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {dockImmersive && titleBarHost
        ? createPortal(
            <DockTabBar
              variant="immersive"
              active={immersiveTab}
              tabs={immersiveTabItems}
              onSelect={selectImmersiveTab}
              onCloseTab={closeDockTab}
              onOpenPanel={(id) => setRightPanel(id)}
              expanded
              onToggleExpanded={toggleDockExpanded}
            />,
            titleBarHost
          )
        : null}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {dockImmersive ? (
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg"
            data-dock-immersive
            data-dock-expanded="1"
          >
            {/* Fallback when TitleBar host is absent (unit tests / non-shell mounts). */}
            {!titleBarHost ? (
              <DockTabBar
                variant="immersive"
                active={immersiveTab}
                tabs={immersiveTabItems}
                onSelect={selectImmersiveTab}
                onCloseTab={closeDockTab}
                onOpenPanel={(id) => setRightPanel(id)}
                expanded
                onToggleExpanded={toggleDockExpanded}
              />
            ) : null}
            <div
              className={cn(
                'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                immersiveTab === 'agent' ? 'flex' : 'hidden'
              )}
              aria-hidden={immersiveTab !== 'agent'}
              inert={immersiveTab !== 'agent' ? true : undefined}
              data-immersive-agent
            >
              {agentColumn}
            </div>
            {panelBodies}
          </div>
        ) : (
          <>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">{agentColumn}</div>
            {activeRightPanel ? (
              <>
                <PanelResizeHandle
                  label="Resize panel"
                  value={dockWidthPx}
                  min={DOCK_WIDTH_MIN_PX}
                  max={dockMaxPx}
                  edge="start"
                  onChange={(next) => {
                    setDockWidthPx(next)
                  }}
                />
                <aside
                  className={CHAT_RIGHT_PANEL}
                  style={{ width: dockWidthPx }}
                  data-right-dock
                  data-dock-expanded="0"
                >
                  <DockTabBar
                    active={activeRightPanel}
                    tabs={tabItems}
                    onSelect={(id) => {
                      if (id !== 'agent') setRightPanel(id)
                    }}
                    onCloseTab={closeDockTab}
                    onOpenPanel={(id) => setRightPanel(id)}
                    expanded={false}
                    onToggleExpanded={toggleDockExpanded}
                  />
                  {panelBodies}
                </aside>
              </>
            ) : null}
            {activeRightPanel === null ? (
              <ChatSideRail
                activePanel={null}
                onSelectPanel={toggleRightPanel}
                onExpandPanels={
                  dockTabs.length > 0 ? () => toggleDockExpanded() : undefined
                }
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
