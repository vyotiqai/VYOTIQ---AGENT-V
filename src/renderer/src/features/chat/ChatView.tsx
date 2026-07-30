import type { Ref } from 'react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageList } from './components/MessageList'
import { AgentBrowserPanel } from './components/AgentBrowserPanel'
import { ChangesPanel } from './components/ChangesPanel'
import { PlanPanel } from './components/PlanPanel'
import { ChatSideRail } from './components/ChatSideRail'
import { TerminalPanel } from './components/TerminalPanel'
import { Composer } from './components/composer'
import { RunSessionProvider } from './RunSessionContext'
import {
  ChatGitLeading,
  ChatGitTrailing,
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
  COMPOSER_DOCK_FADE_PX,
  COMPOSER_DOCK_FALLBACK_PX,
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
  canUndoWrites,
  undoBusy,
  onUndoWrites,
  writeFileResolutions,
  writeResolvablePaths,
  onKeepWriteFile,
  onDiscardWriteFile,
  onKeepAllWrites
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
  canUndoWrites?: boolean
  undoBusy?: boolean
  onUndoWrites?: () => void | Promise<unknown>
  writeFileResolutions?: ReadonlyMap<string, 'kept' | 'discarded' | undefined>
  writeResolvablePaths?: ReadonlySet<string>
  onKeepWriteFile?: (path: string) => void | Promise<unknown>
  onDiscardWriteFile?: (path: string) => void | Promise<unknown>
  onKeepAllWrites?: () => void | Promise<unknown>
}) {
  const runSession = useMemo(
    () => ({ workspacePath, runId: activeRunId }),
    [workspacePath, activeRunId]
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
  onKeepAllWrites
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
      if (raw === 'browser' || raw === 'terminal' || raw === 'changes') {
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
  const [browserActive, setBrowserActive] = useState(false)
  const liveItems = useChatLiveItems(itemsStore, items)

  const setRightPanel = useCallback((next: ChatRightPanelId | null) => {
    setActiveRightPanel(next)
    try {
      if (next) localStorage.setItem(RIGHT_PANEL_KEY, next)
      else localStorage.removeItem(RIGHT_PANEL_KEY)
      localStorage.setItem(BROWSER_PANEL_OPEN_KEY, next === 'browser' ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const toggleRightPanel = useCallback(
    (panel: ChatRightPanelId) => {
      setRightPanel(activeRightPanel === panel ? null : panel)
    },
    [activeRightPanel, setRightPanel]
  )

  useEffect(() => {
    let cancelled = false
    let wasOpen = false
    void window.vyotiq?.browserGetState?.().then((res) => {
      if (cancelled || !res.ok) return
      wasOpen = Boolean(res.data.open)
      setBrowserActive(wasOpen)
      // Only auto-open on first load when no panel preference is restored yet.
      // Do not override a persisted Terminal/Changes selection.
    })
    const unsub = window.vyotiq?.onBrowserState?.((next) => {
      if (cancelled) return
      const open = Boolean(next.open)
      setBrowserActive(open)
      // Rising edge only: agent just opened a page — show the browser panel
      // without stealing an already-selected Terminal/Changes panel.
      if (open && !wasOpen) {
        setActiveRightPanel((current) => {
          if (current === 'terminal' || current === 'changes') {
            return current
          }
          try {
            localStorage.setItem(RIGHT_PANEL_KEY, 'browser')
            localStorage.setItem(BROWSER_PANEL_OPEN_KEY, '1')
          } catch {
            /* ignore */
          }
          return 'browser'
        })
      }
      wasOpen = open
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  // Transcript scrolls behind the floating composer, so it has to reserve the
  // dock height plus the fade painted above it (not included in offsetHeight).
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const dock = stage.querySelector<HTMLElement>('[data-composer-dock]')
    if (!dock) return undefined

    const sync = (): void => {
      const dockH = Math.max(dock.offsetHeight, 48) + COMPOSER_DOCK_FADE_PX
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
    disabled: !hasWorkspace || Boolean(transcriptLoading),
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
    runNotice,
    incomplete,
    onContinue,
    onContinueInAgent,
    activeRunId,
    contextUsage: metaStore ? undefined : contextUsage,
    metaStore,
    onCompactContext,
    composerPlaceholder: transcriptLoading ? 'Loading chat…' : undefined,
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
                canUndoWrites={canUndoWrites}
                undoBusy={undoBusy}
                onUndoWrites={onUndoWrites}
                writeFileResolutions={writeFileResolutions}
                writeResolvablePaths={writeResolvablePaths}
                onKeepWriteFile={onKeepWriteFile}
                onDiscardWriteFile={onDiscardWriteFile}
                onKeepAllWrites={onKeepAllWrites}
              />

              <MemoComposer
                key={`composer:${surfaceKey}`}
                {...composerProps}
                variant="dock"
                bannerError={bannerError}
                onDismissError={onDismissError}
                leading={
                  <ChatGitLeading
                    itemsStore={itemsStore}
                    items={items}
                    workspacePath={workspacePath}
                    running={running}
                    enabled
                  />
                }
                trailing={
                  <ChatGitTrailing
                    itemsStore={itemsStore}
                    items={items}
                    workspacePath={workspacePath}
                    running={running}
                    enabled
                  />
                }
              />
            </div>
          )}
        </div>
        {activeRightPanel === 'browser' ? (
          <AgentBrowserPanel
            workspacePath={workspacePath}
            activeRunId={activeRunId}
            onClose={() => setRightPanel(null)}
          />
        ) : null}
        {activeRightPanel === 'terminal' ? (
          <TerminalPanel
            items={liveItems}
            onClose={() => setRightPanel(null)}
            onLoadToolContent={onLoadToolContent}
          />
        ) : null}
        {activeRightPanel === 'changes' ? (
          <ChangesPanel
            items={liveItems}
            onClose={() => setRightPanel(null)}
            writeFileResolutions={writeFileResolutions}
            resolvablePaths={writeResolvablePaths}
            canResolve={canUndoWrites}
            resolveBusy={undoBusy}
            onKeepWriteFile={onKeepWriteFile}
            onDiscardWriteFile={onDiscardWriteFile}
            onKeepAllWrites={onKeepAllWrites}
            onDiscardAllWrites={onUndoWrites}
          />
        ) : null}
        {activeRightPanel === 'plan' ? (
          <PlanPanel
            workspacePath={workspacePath}
            runId={activeRunId}
            running={running}
            onClose={() => setRightPanel(null)}
          />
        ) : null}
        <ChatSideRail
          activePanel={activeRightPanel}
          browserActive={browserActive}
          onSelectPanel={toggleRightPanel}
        />
      </div>
    </div>
  )
}
