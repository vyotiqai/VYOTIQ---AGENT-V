import { useCallback, useSyncExternalStore } from 'react'
import { Icon } from '@renderer/lib/icons'
import { IconButton, cn } from '@renderer/lib/ui'
import type { ProviderId, ServiceTier } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { knownContextWindow } from '@shared/domain/modelContextWindows'
import { MAX_IMAGES } from './useComposerImages'
import { MAX_FILES } from './useComposerFiles'
import { ContextMeter, type ContextUsageState } from './ContextMeter'
import { ModelPicker } from './ModelPicker'
import { ModePicker } from './ModePicker'
import { ThinkingControls } from './ThinkingControls'
import { chromeLabelText } from './composerChrome'
import type { ModelPickerOption } from './composerModelUtils'
import type { ModelInfo } from '@shared/ipc'
import type { AgentInteractionMode } from '@shared/ipc'
import type { ChatMetaStore } from '../../chatStores'

function ContextMeterLeaf({
  metaStore,
  usage,
  modelWindow,
  compactionTriggerRatio,
  onCompact,
  compactDisabled
}: {
  metaStore?: ChatMetaStore
  usage?: ContextUsageState | null
  modelWindow?: number | null
  compactionTriggerRatio?: number
  onCompact?: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>
  compactDisabled?: boolean
}) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => metaStore?.subscribeMeta(onStoreChange) ?? (() => {}),
    [metaStore]
  )
  const getRevision = useCallback(() => metaStore?.getMetaRevision() ?? 0, [metaStore])
  useSyncExternalStore(subscribe, getRevision, getRevision)
  const resolved = metaStore ? metaStore.getContextUsage() : (usage ?? null)
  return (
    <ContextMeter
      usage={resolved}
      modelWindow={modelWindow}
      compactionTriggerRatio={compactionTriggerRatio}
      onCompact={onCompact}
      compactDisabled={compactDisabled}
    />
  )
}

/** Shared compact control height for the toolbar row. */
const iconCtl =
  'inline-grid size-7 shrink-0 place-items-center rounded-xl text-muted vy-transition hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)] disabled:hover:bg-transparent disabled:hover:text-muted'

/** Size to content; truncate only when the middle zone is constrained. */
const modelPillTrigger = cn(
  'inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-xl border-0 bg-transparent px-2',
  chromeLabelText,
  'text-fg hover:bg-surface active:bg-surface',
  'vy-transition disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)]'
)

const sendCtl = cn(
  'inline-grid size-7 shrink-0 place-items-center rounded-xl vy-transition',
  'disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)]'
)

/** Shared control row — every pill/icon aligns to the same 28px baseline. */
const zone = 'flex h-7 min-w-0 items-center gap-0.5'

export type ComposerVariant = 'hero' | 'dock' | 'inline'

export function ComposerToolbar({
  variant,
  disabled,
  locked,
  attachDisabled,
  imageCount,
  fileCount,
  onAttachClick,
  providers,
  optionsByProvider,
  seedsByProvider,
  modelMetaByValue,
  provider,
  model,
  favoriteModels,
  recentModels,
  modelsWarning,
  serviceTier,
  onModelChange,
  onToggleFavorite,
  onServiceTierChange,
  onRefreshCatalog,
  onBrowseProvider,
  catalogLoading,
  chatSettings,
  onChatSettingsChange,
  agentMode,
  onAgentModeChange,
  running,
  canSend,
  onStop,
  contextUsage,
  metaStore,
  onCompactContext,
  onCancelEdit
}: {
  variant: ComposerVariant
  disabled?: boolean
  locked: boolean
  /** When set, only blocks attach (input may stay open while settings stay locked). */
  attachDisabled?: boolean
  imageCount: number
  fileCount: number
  onAttachClick: () => void
  providers: ProviderId[]
  optionsByProvider: Record<ProviderId, ModelPickerOption[]>
  seedsByProvider: Record<ProviderId, ModelPickerOption[]>
  modelMetaByValue: Record<string, ModelInfo>
  provider: ProviderId
  model: string
  favoriteModels: string[]
  recentModels: string[]
  modelsWarning: string | null
  serviceTier: ServiceTier
  onModelChange: (provider: ProviderId, model: string) => void
  onToggleFavorite: (provider: ProviderId, model: string) => void
  onServiceTierChange: (tier: ServiceTier) => void
  onRefreshCatalog: () => void
  onBrowseProvider?: (provider: ProviderId) => void
  catalogLoading?: boolean
  chatSettings: EffectiveChatSettings
  onChatSettingsChange: (patch: ChatSettingsPatch) => void
  agentMode: AgentInteractionMode
  onAgentModeChange: (mode: AgentInteractionMode) => void
  running: boolean
  canSend: boolean
  onStop: () => void
  contextUsage?: ContextUsageState | null
  metaStore?: ChatMetaStore
  onCompactContext?: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>
  onCancelEdit?: () => void
}) {
  void disabled
  const isInline = variant === 'inline'

  const imagesFull = imageCount >= MAX_IMAGES
  const filesFull = fileCount >= MAX_FILES
  const attachFull = imagesFull && filesFull
  const attachBlocked = Boolean(attachDisabled ?? locked)
  const attachLabel = attachFull
    ? `Attach files (limits reached: ${MAX_IMAGES} images, ${MAX_FILES} files)`
    : imagesFull
      ? `Attach files (image limit ${MAX_IMAGES}; documents still available)`
      : filesFull
        ? `Attach files (file limit ${MAX_FILES}; images still available)`
        : 'Attach files'

  const modelKey = `${provider}:${model}`
  const modelMeta = modelMetaByValue[modelKey] ?? modelMetaByValue[model]
  const modelWindow =
    knownContextWindow(model, provider) ??
    (modelMeta?.contextWindow && modelMeta.contextWindow > 0 ? modelMeta.contextWindow : null)

  const sendOrStop = (
    <div className="flex items-center gap-0.5">
      {isInline && onCancelEdit ? (
        <button
          type="button"
          className={iconCtl}
          aria-label="Cancel edit"
          title="Cancel edit (Esc)"
          onClick={onCancelEdit}
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
      {running ? (
        <IconButton
          icon="stop"
          label="Stop"
          size="sm"
          variant="primary"
          className="size-7 shrink-0 rounded-xl"
          onClick={onStop}
        />
      ) : null}
      <button
        type="submit"
        className={cn(
          sendCtl,
          canSend ? 'bg-accent text-accent-fg hover:bg-fg-strong' : 'bg-surface-2 text-muted'
        )}
        aria-label={isInline ? 'Resend' : running ? 'Send follow-up' : 'Send'}
        title={isInline ? 'Resend edited message' : undefined}
        disabled={!canSend}
      >
        <Icon name="send" size={14} weight="fill" />
      </button>
    </div>
  )

  return (
    <div
      className="col-span-full grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 gap-y-1"
      data-composer-toolbar
    >
      {/* Left */}
      <div className={zone}>
        <button
          type="button"
          className={iconCtl}
          aria-label={attachLabel}
          title={attachLabel}
          disabled={attachBlocked || attachFull}
          onClick={onAttachClick}
        >
          <Icon name="paperclip" size={15} />
        </button>
      </div>

      {/* Middle: mode + model + thinking, truncates into the flexible column */}
      <div className={zone}>
        <ModePicker
          mode={agentMode}
          onModeChange={onAgentModeChange}
          disabled={locked}
          running={running}
        />
        <ModelPicker
          className="min-w-0 max-w-[16rem] shrink @max-[420px]:max-w-[min(100%,16rem)]"
          triggerClassName={modelPillTrigger}
          providers={providers}
          optionsByProvider={optionsByProvider}
          seedsByProvider={seedsByProvider}
          modelMetaByValue={modelMetaByValue}
          provider={provider}
          model={model}
          favoriteModels={favoriteModels}
          recentModels={recentModels}
          modelsWarning={modelsWarning}
          serviceTier={serviceTier}
          onModelChange={onModelChange}
          onToggleFavorite={onToggleFavorite}
          onServiceTierChange={onServiceTierChange}
          onRefreshCatalog={onRefreshCatalog}
          onBrowseProvider={onBrowseProvider}
          catalogLoading={catalogLoading}
          disabled={locked}
        />
        <ThinkingControls
          provider={provider}
          model={model}
          chatSettings={chatSettings}
          onChatSettingsChange={onChatSettingsChange}
          disabled={locked}
          running={running}
        />
      </div>

      {/* Right: context + send, always trailing */}
      <div className={cn(zone, 'justify-end')}>
        <ContextMeterLeaf
          metaStore={metaStore}
          usage={contextUsage}
          modelWindow={modelWindow}
          compactionTriggerRatio={chatSettings.compactionTriggerRatio}
          onCompact={onCompactContext}
          compactDisabled={running}
        />
        {sendOrStop}
      </div>
    </div>
  )
}
