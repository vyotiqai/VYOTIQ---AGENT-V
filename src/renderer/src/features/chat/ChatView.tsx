import type { Ref } from 'react'
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { MessageList } from './components/MessageList'
import { Composer } from './components/composer'
import {
  ChatGitLeading,
  ChatGitTrailing,
  useChatLiveItems,
  useHasChatItems
} from './components/ChatStreamLeaves'
import { RecentsPicker } from './RecentsPicker'
import type { UiItem } from '@shared/transcript'
import type { AgentInteractionMode, ProviderId, ToolApprovalDecision } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { Alert } from '@renderer/lib/ui'
import {
  CHAT_COLUMN_MAX,
  CHAT_GUTTER,
  COMPOSER_DOCK_FADE_PX,
  COMPOSER_DOCK_FALLBACK_PX
} from '@renderer/lib/utils/layout'
import { cn } from '@renderer/lib/ui/cn'
import type { ChatItemsStore, ChatMetaStore } from './chatStores'

export type { ChatItemsStore, ChatMetaStore } from './chatStores'

const MemoComposer = memo(Composer)

function TranscriptPane({
  itemsStore,
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
  collapsedTurns,
  showThinking,
  mcpServerNames,
  surfaceKey,
  canUndoWrites,
  undoBusy,
  onUndoWrites,
  writeFileResolutions,
  onKeepWriteFile,
  onDiscardWriteFile,
  onKeepAllWrites
}: {
  itemsStore?: ChatItemsStore
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
  collapsedTurns?: ReadonlySet<number>
  showThinking?: boolean
  mcpServerNames?: ReadonlyMap<string, string>
  surfaceKey: string
  canUndoWrites?: boolean
  undoBusy?: boolean
  onUndoWrites?: () => void | Promise<unknown>
  writeFileResolutions?: ReadonlyMap<string, 'kept' | 'discarded' | undefined>
  onKeepWriteFile?: (path: string) => void | Promise<unknown>
  onDiscardWriteFile?: (path: string) => void | Promise<unknown>
  onKeepAllWrites?: () => void | Promise<unknown>
}) {
  const liveItems = useChatLiveItems(itemsStore, items)
  return (
    <MessageList
      key={`transcript:${surfaceKey}`}
      items={liveItems}
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
      collapsedTurns={collapsedTurns}
      showThinking={showThinking}
      mcpServerNames={mcpServerNames}
      canUndoWrites={canUndoWrites}
      undoBusy={undoBusy}
      onUndoWrites={onUndoWrites}
      writeFileResolutions={writeFileResolutions}
      onKeepWriteFile={onKeepWriteFile}
      onDiscardWriteFile={onDiscardWriteFile}
      onKeepAllWrites={onKeepAllWrites}
    />
  )
}

export function ChatView({
  hasOpenWorkspaces,
  recentPaths,
  needsWorkspaceForMigration,
  pendingMigrationCount,
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
  onOpenRecent,
  onAddWorkspace,
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
  collapsedTurns,
  showThinking = true,
  chatSurfaceEpoch = 0,
  mcpServerNames,
  slashHandlers,
  canUndoWrites = false,
  undoBusy = false,
  onUndoWrites,
  writeFileResolutions,
  onKeepWriteFile,
  onDiscardWriteFile,
  onKeepAllWrites
}: {
  hasOpenWorkspaces: boolean
  recentPaths: string[]
  needsWorkspaceForMigration?: boolean
  pendingMigrationCount?: number
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
  onOpenRecent: (path: string) => void
  onAddWorkspace: () => void
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

  if (!hasOpenWorkspaces) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <h1 ref={headingRef} tabIndex={-1} className="sr-only">
          Vyotiq chat
        </h1>
        {bannerError ? (
          <Alert className={cn('mx-5 mb-2 mt-2 sm:mx-8')} onDismiss={onDismissError}>
            {bannerError}
          </Alert>
        ) : null}
        <RecentsPicker
          recentPaths={recentPaths}
          needsWorkspaceForMigration={needsWorkspaceForMigration}
          pendingMigrationCount={pendingMigrationCount}
          onOpenRecent={onOpenRecent}
          onAddWorkspace={onAddWorkspace}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
              itemsStore={itemsStore}
              items={items}
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
              collapsedTurns={collapsedTurns}
              showThinking={showThinking}
              mcpServerNames={mcpServerNames}
              surfaceKey={surfaceKey}
              canUndoWrites={canUndoWrites}
              undoBusy={undoBusy}
              onUndoWrites={onUndoWrites}
              writeFileResolutions={writeFileResolutions}
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
    </div>
  )
}
