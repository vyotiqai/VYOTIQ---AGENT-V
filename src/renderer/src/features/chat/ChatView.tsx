import type { Ref } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { GitBranchStrip, GitChangePills, useGitChrome } from './components/GitChrome'
import { MessageList } from './components/MessageList'
import { Composer } from './components/composer'
import { RecentsPicker } from './RecentsPicker'
import type { UiItem } from '@shared/transcript'
import type { ProviderId, ToolApprovalDecision } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { Alert } from '@renderer/lib/ui'
import {
  CHAT_COLUMN,
  CHAT_COLUMN_MAX,
  CHAT_GUTTER,
  COMPOSER_DOCK_FADE_PX,
  COMPOSER_DOCK_FALLBACK_PX
} from '@renderer/lib/utils/layout'
import { cn } from '@renderer/lib/ui/cn'

/** Bumps on workspace change, run end, and (debounced) mid-run mutating tool results. */
const MUTATING_GIT_TOOLS = new Set([
  'edit',
  'multi_edit',
  'delete',
  'terminal',
  'memory_write'
])

function useGitRevision(
  workspacePath: string | null,
  running: boolean,
  items: UiItem[]
): number {
  const [revision, setRevision] = useState(0)
  const wasRunning = useRef(running)
  const mutatingDoneCount = useRef(0)

  useEffect(() => {
    if (wasRunning.current && !running) setRevision((value) => value + 1)
    if (!wasRunning.current && running) mutatingDoneCount.current = 0
    wasRunning.current = running
  }, [running])

  useEffect(() => {
    setRevision((value) => value + 1)
  }, [workspacePath])

  useEffect(() => {
    if (!running) return
    let count = 0
    for (const item of items) {
      if (item.kind !== 'tool') continue
      if (item.tool.status !== 'done' && item.tool.status !== 'fail') continue
      if (MUTATING_GIT_TOOLS.has(item.tool.name)) count++
    }
    if (count <= mutatingDoneCount.current) return
    mutatingDoneCount.current = count
    const timer = window.setTimeout(() => {
      setRevision((value) => value + 1)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [items, running])

  return revision
}

export function ChatView({
  hasOpenWorkspaces,
  recentPaths,
  needsWorkspaceForMigration,
  pendingMigrationCount,
  items,
  running,
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
  onApprovalDecision,
  showThinking = true,
  chatSurfaceEpoch = 0
}: {
  hasOpenWorkspaces: boolean
  recentPaths: string[]
  needsWorkspaceForMigration?: boolean
  pendingMigrationCount?: number
  items: UiItem[]
  running: boolean
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
  onApprovalDecision?: (requestId: string, decision: ToolApprovalDecision) => void | Promise<void>
  showThinking?: boolean
  /**
   * Bumps on workspace / run-tab switches (not draft→run id assignment) so the
   * transcript and composer remount without clearing mid-send attachments.
   */
  chatSurfaceEpoch?: number
}) {
  const bannerError = operationalError ?? error
  const showHero = items.length === 0 && !activeRunId && !transcriptLoading
  // A finished turn is the moment the working tree is most likely to have moved.
  const gitRevision = useGitRevision(workspacePath, running, items)
  // The hero has no dock, so there is nowhere to show a repository state yet.
  const gitChrome = useGitChrome(workspacePath, gitRevision, !showHero)
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
    onProviderModel,
    favoriteModels,
    recentModels,
    serviceTier,
    onToggleFavorite,
    onServiceTierChange,
    chatSettings,
    onChatSettingsChange,
    onSend,
    onStop,
    runNotice,
    incomplete,
    onContinue,
    contextUsage,
    onCompactContext,
    composerPlaceholder: transcriptLoading ? 'Loading chat…' : undefined
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
              <Composer
                key={`composer:${surfaceKey}`}
                {...composerProps}
                variant="hero"
                className="w-full"
              />
            </div>
          </div>
        ) : (
          <div ref={stageRef} className="relative flex min-h-0 flex-1 flex-col" data-chat-stage>
            <MessageList
              key={`transcript:${surfaceKey}`}
              items={items}
              reserveComposerSpace
              dockReservePx={dockReservePx}
              restoreScrollTop={restoreScrollTop}
              scrollRestoreToken={scrollRestoreToken}
              onScrollTopChange={onScrollTopChange}
              onLoadToolContent={onLoadToolContent}
              onThinkingToggle={onThinkingToggle}
              onToolToggle={onToolToggle}
              onGroupToggle={onGroupToggle}
              onApprovalDecision={onApprovalDecision}
              showThinking={showThinking}
            />

            <Composer
              key={`composer:${surfaceKey}`}
              {...composerProps}
              variant="dock"
              bannerError={bannerError}
              onDismissError={onDismissError}
              leading={<GitChangePills chrome={gitChrome} />}
              trailing={<GitBranchStrip chrome={gitChrome} />}
            />
          </div>
        )}
      </div>
    </div>
  )
}
