import { Icon } from '@renderer/lib/icons'
import { IconButton, cn } from '@renderer/lib/ui'
import type { ProviderId, ServiceTier } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { MAX_IMAGES } from './useComposerImages'
import { ContextMeter, type ContextUsageState } from './ContextMeter'
import { ModelPicker } from './ModelPicker'
import { ThinkingControls } from './ThinkingControls'
import type { ModelPickerOption } from './composerModelUtils'
import type { ModelInfo } from '@shared/ipc'

const iconCtl =
  'inline-grid size-8 place-items-center rounded-full text-muted vy-transition hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)] disabled:hover:bg-transparent disabled:hover:text-muted'

const modelPillTrigger = cn(
  'inline-flex max-w-none min-h-8 items-center gap-1 rounded-full border-0 bg-transparent px-2.5 text-xs tracking-[var(--vy-tracking)] text-muted',
  'hover:bg-surface hover:text-fg active:bg-surface',
  'vy-transition disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)]'
)

export type ComposerVariant = 'hero' | 'dock'

export function ComposerToolbar({
  variant,
  disabled,
  locked,
  imagesCount,
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
  running,
  canSend,
  onStop,
  contextUsage,
  onCompactContext
}: {
  variant: ComposerVariant
  disabled?: boolean
  locked: boolean
  imagesCount: number
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
  running: boolean
  canSend: boolean
  onStop: () => void
  contextUsage?: ContextUsageState | null
  onCompactContext?: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>
}) {
  const modelMenuClass =
    variant === 'hero'
      ? 'min-w-0 max-w-full sm:max-w-[320px]'
      : 'min-w-0 max-w-[min(100%,20rem)] sm:max-w-[320px]'

  return (
    <div
      className="col-span-full flex items-center justify-between gap-2"
      data-composer-toolbar
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <button
          type="button"
          className={iconCtl}
          aria-label={
            imagesCount >= MAX_IMAGES ? `Attach image (limit ${MAX_IMAGES})` : 'Attach image'
          }
          title={imagesCount >= MAX_IMAGES ? `Up to ${MAX_IMAGES} images` : 'Attach image'}
          disabled={locked || imagesCount >= MAX_IMAGES}
          onClick={onAttachClick}
        >
          <Icon name="plus" size={14} />
        </button>
        <ModelPicker
          className={cn('min-w-0 flex-shrink', modelMenuClass)}
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
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ContextMeter
          usage={contextUsage ?? null}
          onCompact={running ? undefined : onCompactContext}
        />
        {running ? (
          <IconButton
            icon="stop"
            label="Stop"
            size="sm"
            variant="primary"
            className="size-8 rounded-full"
            onClick={onStop}
          />
        ) : (
          <button
            type="submit"
            className={cn(
              'inline-grid size-8 place-items-center rounded-full vy-transition disabled:cursor-not-allowed',
              canSend
                ? 'bg-accent text-accent-fg hover:bg-fg-strong'
                : 'bg-surface-2 text-muted'
            )}
            aria-label="Send"
            disabled={!canSend}
          >
            <Icon name="arrowUp" size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
