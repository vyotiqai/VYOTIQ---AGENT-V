import type { Ref } from 'react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageList } from './components/MessageList'
import { AgentBrowserPanel } from './components/AgentBrowserPanel'
import { ChangesPanel } from './components/ChangesPanel'
import { PlanPanel } from './components/PlanPanel'
import { PrPanel } from './components/PrPanel'
import { ChatSideRail } from './components/ChatSideRail'
import { DockTabBar, defaultDockTab } from './components/DockTabBar'
import { TerminalPanel } from './components/TerminalPanel'
import { isPlanDraftReady } from './components/composer/PlanHandoff'
import { Composer } from './components/composer'
import { RunSessionProvider } from './RunSessionContext'
import {
  ChatGitLeading,
  ChatGitTrailing,
  useChatGitChrome,
  useChatLiveItems,
  useHasChatItems
} from './components/ChatStreamLeaves'
import type { UiItem } from '@shared/transcript'
import type { AgentInteractionMode, ProviderId, ToolApprovalDecision } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { Alert } from '@renderer/lib/ui'
import {
  BROWSER_PANEL_OPEN_KEY,
  CHAT_COLUMN_MAX,
  CHAT_GUTTER,
  CHAT_RIGHT_PANEL,
  CHAT_RIGHT_PANEL_EXPANDED,
  COMPOSER_DOCK_CLEARANCE_PX,
  COMPOSER_DOCK_FADE_PX,
  COMPOSER_DOCK_FALLBACK_PX,
  DOCK_EXPANDED_KEY,
  RIGHT_PANEL_KEY,
  type ChatRightPanelId
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
  onOpenChanges
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
  onQuestionSubmit?: (requestId: string, answers: string[]) => void | Promise<void>
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
    files?: import('@shared/ipc').AttachedFile[]
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
  onQuestionSubmit?: (requestId: string, answers: string[]) => void | Promise<void>
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
  const [terminalTabTitle, setTerminalTabTitle] = useState<string | null>(null)
  /** Accumulated dock title tabs (multi-panel strip). */
  const [dockTabs, setDockTabs] = useState<ChatRightPanelId[]>(() =>
    activeRightPanel ? [activeRightPanel] : []
  )
  /** Keep panels mounted (hidden) when switching so PTY/browser state survives. */
  const [mountedPanels, setMountedPanels] = useState<ChatRightPanelId[]>(() =>
    activeRightPanel ? [activeRightPanel] : []
  )
  const [dockExpanded, setDockExpanded] = useState(() => {
    try {
      return localStorage.getItem(DOCK_EXPANDED_KEY) === '1'
    } catch {
      return false
    }
  })
  /** Session-scoped: skip auto-open after the user closes a panel until they open it again. */
  const dismissedPanelsRef = useRef<Set<ChatRightPanelId>>(new Set())
  const wasChangesActiveRef = useRef(false)
  const liveItems = useChatLiveItems(itemsStore, items)
  const gitChrome = useChatGitChrome(itemsStore, items, workspacePath, running, Boolean(workspacePath))
  const gitRevision = useMemo(() => {
    // Keep a cheap bump for panels that still take a revision prop; prefer chrome status for auto-open.
    let n = 0
    for (const item of liveItems) {
      if (item.kind === 'tool' && item.tool.status === 'done') n += 1
    }
    return n + (running ? 0 : 1) + (gitChrome.status?.fileCount ?? 0)
  }, [liveItems, running, gitChrome.status?.fileCount])

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
    // Keep mountedPanels/dockTabs so PTY/browser/plan state survives hide; clear
    // only when the last tab is closed via closeDockTab.
    persistRightPanel(null)
  }, [persistRightPanel])

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
      persistRightPanel(next)
    },
    [closeDock, persistRightPanel]
  )

  const tryAutoOpenPanel = useCallback(
    (panel: ChatRightPanelId) => {
      if (dismissedPanelsRef.current.has(panel)) return
      setDockTabs((prev) => (prev.includes(panel) ? prev : [...prev, panel]))
      setMountedPanels((prev) => (prev.includes(panel) ? prev : [...prev, panel]))
      setActiveRightPanel((current) => {
        if (current === panel) return current
        if (
          current === 'browser' ||
          current === 'terminal' ||
          current === 'changes' ||
          current === 'plan' ||
          current === 'pr'
        ) {
          // Another panel is focused — add the tab but do not steal focus.
          return current
        }
        persistRightPanel(panel)
        return panel
      })
    },
    [persistRightPanel]
  )

  const closeDockTab = useCallback(
    (id: ChatRightPanelId) => {
      dismissedPanelsRef.current.add(id)
      if (id === 'terminal') setTerminalTabTitle(null)
      setDockTabs((prev) => {
        const next = prev.filter((t) => t !== id)
        setMountedPanels((mounted) => mounted.filter((t) => t !== id))
        if (next.length === 0) {
          setActiveRightPanel(null)
          persistRightPanel(null)
          return []
        }
        setActiveRightPanel((active) => {
          if (active !== id) return active
          const fallback = next[next.length - 1] ?? null
          persistRightPanel(fallback)
          return fallback
        })
        return next
      })
    },
    [persistRightPanel]
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
    setDockExpanded((prev) => {
      const next = !prev
      try {
        localStorage.setItem(DOCK_EXPANDED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  useEffect(() => {
    setPrNumber(null)
    setTerminalTabTitle(null)
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

  // Auto-open plan panel when plan.md is ready in plan mode
  useEffect(() => {
    if (!workspacePath || !activeRunId) {
      return
    }
    let cancelled = false
    const tick = (): void => {
      void window.vyotiq.readRunArtifact?.({ workspacePath, runId: activeRunId, name: 'plan.md' }).then(
        (res) => {
          if (cancelled) return
          const ready = Boolean(res.ok && isPlanDraftReady(res.data?.content))
          if (ready && agentMode === 'plan') {
            tryAutoOpenPanel('plan')
          }
        }
      )
    }
    tick()
    if (!running) return undefined
    const id = window.setInterval(tick, 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [workspacePath, activeRunId, running, agentMode, tryAutoOpenPanel])

  // Auto-open terminal when agent starts a prominent terminal tool
  useEffect(() => {
    if (!agentTerminalRunning) return
    tryAutoOpenPanel('terminal')
  }, [agentTerminalRunning, tryAutoOpenPanel])

  const tabItems = useMemo(
    () =>
      dockTabs.map((id) => {
        const tab = defaultDockTab(id, id === 'pr' ? prNumber : null)
        if (id === 'terminal' && terminalTabTitle) {
          return { ...tab, label: `>_ ${terminalTabTitle}` }
        }
        return tab
      }),
    [dockTabs, prNumber, terminalTabTitle]
  )

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
  }, [showHero, surfaceKey])

  const composerProps = {
    provider,
    model,
    running,
    disabled: !hasWorkspace,
    hasTranscript: !showHero,
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
    slashHandlers
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <h1 ref={headingRef} tabIndex={-1} className="sr-only">
            Vyotiq chat
          </h1>

          {showHero ? (
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col items-center justify-center',
                CHAT_GUTTER
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
                onOpenChanges={() => setRightPanel('changes')}
              />

              <MemoComposer
                key={`composer:${surfaceKey}`}
                {...composerProps}
                variant="dock"
                bannerError={bannerError}
                onDismissError={onDismissError}
                leading={
                  <ChatGitLeading chrome={gitChrome} onOpenChanges={() => setRightPanel('changes')} />
                }
                trailing={
                  <ChatGitTrailing chrome={gitChrome} />
                }
              />
            </div>
          )}
        </div>
        {activeRightPanel ? (
          <aside
            className={dockExpanded ? CHAT_RIGHT_PANEL_EXPANDED : CHAT_RIGHT_PANEL}
            data-right-dock
            data-dock-expanded={dockExpanded ? '1' : '0'}
          >
            <DockTabBar
              active={activeRightPanel}
              tabs={tabItems}
              onSelect={(id) => setRightPanel(id)}
              onCloseTab={closeDockTab}
              onOpenPanel={(id) => setRightPanel(id)}
              expanded={dockExpanded}
              onToggleExpanded={toggleDockExpanded}
            />
            {mountedPanels.includes('browser') ? (
              <div
                className={cn(
                  'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                  activeRightPanel === 'browser' ? 'flex' : 'hidden'
                )}
                aria-hidden={activeRightPanel !== 'browser'}
              >
                <AgentBrowserPanel
                  workspacePath={workspacePath}
                  activeRunId={activeRunId}
                />
              </div>
            ) : null}
            {mountedPanels.includes('terminal') ? (
              <div
                className={cn(
                  'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                  activeRightPanel === 'terminal' ? 'flex' : 'hidden'
                )}
                aria-hidden={activeRightPanel !== 'terminal'}
              >
                <TerminalPanel
                  workspacePath={workspacePath}
                  onActiveSessionChange={(session) => {
                    setTerminalTabTitle(session?.title ?? null)
                  }}
                />
              </div>
            ) : null}
            {mountedPanels.includes('changes') ? (
              <div
                className={cn(
                  'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                  activeRightPanel === 'changes' ? 'flex' : 'hidden'
                )}
                aria-hidden={activeRightPanel !== 'changes'}
              >
                <ChangesPanel
                  items={liveItems}
                  workspacePath={workspacePath}
                  gitRevision={gitRevision}
                  onGitMutated={gitChrome.refresh}
                  onViewPr={() => setRightPanel('pr')}
                  writeFileResolutions={writeFileResolutions}
                  resolvablePaths={writeResolvablePaths}
                  canResolve={canUndoWrites}
                  resolveBusy={undoBusy}
                  resolveBlockedReason={resolveBlockedReason}
                  onKeepWriteFile={onKeepWriteFile}
                  onDiscardWriteFile={onDiscardWriteFile}
                  onKeepAllWrites={onKeepAllWrites}
                  onDiscardAllWrites={onUndoWrites}
                  active={activeRightPanel === 'changes'}
                />
              </div>
            ) : null}
            {mountedPanels.includes('pr') ? (
              <div
                className={cn(
                  'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                  activeRightPanel === 'pr' ? 'flex' : 'hidden'
                )}
                aria-hidden={activeRightPanel !== 'pr'}
              >
                <PrPanel
                  workspacePath={workspacePath}
                  onPrMeta={handlePrMeta}
                  onUnlink={() => closeDockTab('pr')}
                  active={activeRightPanel === 'pr'}
                />
              </div>
            ) : null}
            {mountedPanels.includes('plan') ? (
              <div
                className={cn(
                  'min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                  activeRightPanel === 'plan' ? 'flex' : 'hidden'
                )}
                aria-hidden={activeRightPanel !== 'plan'}
              >
                <PlanPanel
                  workspacePath={workspacePath}
                  runId={activeRunId}
                  running={running}
                />
              </div>
            ) : null}
          </aside>
        ) : null}
        <ChatSideRail
          activePanel={activeRightPanel}
          onSelectPanel={toggleRightPanel}
        />
      </div>
    </div>
  )
}
