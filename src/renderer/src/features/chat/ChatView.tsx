import type { Ref } from 'react'
import { MessageList } from './components/MessageList'
import { ActivityPanel } from './components/ActivityPanel'
import { Composer } from './components/composer'
import { RecentsPicker } from './RecentsPicker'
import type { UiItem } from '@shared/transcript'
import type { ActivityRow } from '@shared/eventUtils'
import type { ProviderId } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { Alert } from '@renderer/lib/ui'
import { CHAT_COLUMN, CHAT_COLUMN_MAX, CHAT_GUTTER } from '@renderer/lib/utils/layout'
import { cn } from '@renderer/lib/ui/cn'

export function ChatView({
  hasOpenWorkspaces,
  recentPaths,
  needsWorkspaceForMigration,
  pendingMigrationCount,
  items,
  activityRows = [],
  running,
  error,
  runNotice,
  runCacheHint,
  contextUsage,
  operationalError,
  runsError: _runsError,
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
  showThinking = true
}: {
  hasOpenWorkspaces: boolean
  recentPaths: string[]
  needsWorkspaceForMigration?: boolean
  pendingMigrationCount?: number
  items: UiItem[]
  activityRows?: ActivityRow[]
  running: boolean
  error: string | null
  runNotice?: string | null
  runCacheHint?: string | null
  contextUsage?: import('./components/composer/ContextMeter').ContextUsageState | null
  operationalError?: string | null
  runsError?: string | null
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
  onSend: (text: string, images?: string[]) => boolean | void | Promise<boolean | void>
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
  showThinking?: boolean
}) {
  const bannerError = operationalError ?? error
  const showHero = items.length === 0 && !activeRunId && !transcriptLoading
  const composerKey = `${workspacePath ?? 'none'}:${activeRunId ?? 'draft'}`

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
    runCacheHint,
    contextUsage,
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
                key={composerKey}
                {...composerProps}
                variant="hero"
                className="w-full"
              />
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col" data-chat-stage>
            <div className={cn('shrink-0 pt-2.5 sm:pt-3', CHAT_GUTTER)}>
              <ActivityPanel rows={activityRows} running={running} />
            </div>
            <MessageList
              items={items}
              running={running}
              reserveComposerSpace
              restoreScrollTop={restoreScrollTop}
              scrollRestoreToken={scrollRestoreToken}
              onScrollTopChange={onScrollTopChange}
              onLoadToolContent={onLoadToolContent}
              onThinkingToggle={onThinkingToggle}
              onToolToggle={onToolToggle}
              showThinking={showThinking}
            />

            <Composer
              key={composerKey}
              {...composerProps}
              variant="dock"
              bannerError={bannerError}
              onDismissError={onDismissError}
            />
          </div>
        )}
      </div>
    </div>
  )
}
