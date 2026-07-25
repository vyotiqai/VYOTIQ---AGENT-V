import { useEffect, useRef, useState } from 'react'
import type { ProviderId, ServiceTier } from '@shared/ipc'
import { buildUserContent } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { Alert, cn } from '@renderer/lib/ui'
import { CHAT_COLUMN, CHAT_GUTTER, FLOATING_CHROME, FLOATING_CHROME_SHADOW_BOTTOM } from '@renderer/lib/utils/layout'
import { ComposerTextarea } from './ComposerTextarea'
import { ComposerToolbar, type ComposerVariant } from './ComposerToolbar'
import { ComposerAttachments } from './ComposerAttachments'
import { ComposerStatus } from './ComposerStatus'
import { useComposerDraft } from './useComposerDraft'
import { useComposerImages, MAX_IMAGES } from './useComposerImages'
import { useComposerModels } from './useComposerModels'

const HERO_HINT =
  'Use /create-rule to control agent behavior through system-level instructions'

export function Composer({
  provider,
  model,
  running,
  disabled,
  hasWorkspace,
  hasTranscript,
  ollamaBaseUrl,
  modelsRefreshKey,
  draft,
  onDraftChange,
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
  composerPlaceholder,
  bannerError,
  runNotice,
  runCacheHint,
  contextUsage,
  onDismissError,
  variant = 'dock',
  className
}: {
  provider: ProviderId
  model: string
  running: boolean
  disabled?: boolean
  hasWorkspace?: boolean
  hasTranscript?: boolean
  ollamaBaseUrl?: string
  modelsRefreshKey?: string | number
  draft?: string
  onDraftChange?: (draft: string) => void
  onProviderModel: (provider: ProviderId, model: string) => void
  favoriteModels?: string[]
  recentModels?: string[]
  serviceTier?: ServiceTier
  onToggleFavorite?: (provider: ProviderId, model: string) => void
  onServiceTierChange?: (tier: ServiceTier) => void
  chatSettings: EffectiveChatSettings
  onChatSettingsChange: (patch: ChatSettingsPatch) => void
  onSend: (text: string, images?: string[]) => boolean | void | Promise<boolean | void>
  onStop: () => void
  composerPlaceholder?: string
  bannerError?: string | null
  runNotice?: string | null
  runCacheHint?: string | null
  contextUsage?: import('./ContextMeter').ContextUsageState | null
  onDismissError?: () => void
  variant?: ComposerVariant
  className?: string
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const locked = Boolean(disabled || running)

  const {
    images,
    setImages,
    imageError,
    setImageError,
    onPickImages,
    removeImage
  } = useComposerImages()

  const { text, setText, canSend, submit, onKeyDown } = useComposerDraft({
    draft,
    onDraftChange,
    images,
    setImages,
    setImageError,
    running,
    disabled,
    onSend
  })

  const [catalogLoading, setCatalogLoading] = useState(false)
  const [browsedProvider, setBrowsedProvider] = useState<ProviderId>(provider)

  useEffect(() => {
    setBrowsedProvider(provider)
  }, [provider])

  const {
    providers,
    optionsByProvider,
    seedsByProvider,
    modelMetaByValue,
    modelsWarning,
    refreshCatalog
  } = useComposerModels({
    provider,
    model,
    ollamaBaseUrl,
    modelsRefreshKey,
    hasWorkspace,
    hasImages: images.length > 0,
    running,
    browsedProvider,
    onProviderModel
  })

  const isDock = variant === 'dock'

  return (
    <div
      className={cn(
        isDock
          ? 'pointer-events-none absolute inset-x-0 bottom-0 z-sticky pb-3'
          : 'shrink-0 w-full pb-0 pt-0',
        isDock ? CHAT_GUTTER : '',
        className
      )}
      data-composer-dock={isDock ? true : undefined}
    >
      <div
        className={cn(isDock && CHAT_COLUMN, 'flex flex-col gap-2')}
        data-composer-column={isDock ? true : undefined}
      >
        {isDock && bannerError ? (
          <Alert className="pointer-events-auto shrink-0" onDismiss={onDismissError}>
            {bannerError}
          </Alert>
        ) : null}

        <form
          onSubmit={submit}
          className={cn(
            '@container grid gap-2.5 p-2.5',
            FLOATING_CHROME,
            FLOATING_CHROME_SHADOW_BOTTOM,
            isDock && 'pointer-events-auto'
          )}
          data-composer-shell
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              void onPickImages(e.target.files)
              e.target.value = ''
            }}
          />

          <ComposerAttachments
            images={images}
            imageError={imageError}
            running={running}
            onRemove={removeImage}
          />

          <ComposerTextarea
            ref={taRef}
            className="col-span-full min-h-[32px] max-h-40 min-w-0 border-0 bg-transparent p-0 text-md leading-relaxed shadow-none focus-visible:ring-0"
            value={text}
            onChange={setText}
            onKeyDown={onKeyDown}
            placeholder={
              composerPlaceholder ?? (hasTranscript ? 'Send follow-up' : 'Send a message')
            }
            disabled={locked}
          />

          <ComposerToolbar
            variant={variant}
            disabled={disabled}
            locked={locked}
            imagesCount={images.length}
            onAttachClick={() => {
              if (images.length >= MAX_IMAGES) {
                setImageError(`You can attach up to ${MAX_IMAGES} images.`)
                return
              }
              fileRef.current?.click()
            }}
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
            onModelChange={onProviderModel}
            onToggleFavorite={onToggleFavorite}
            onServiceTierChange={onServiceTierChange}
            onRefreshCatalog={() => {
              setCatalogLoading(true)
              void refreshCatalog({ forceRefresh: true, provider: browsedProvider }).finally(() =>
                setCatalogLoading(false)
              )
            }}
            onBrowseProvider={setBrowsedProvider}
            catalogLoading={catalogLoading}
            chatSettings={chatSettings}
            onChatSettingsChange={onChatSettingsChange}
            running={running}
            canSend={canSend}
            onStop={onStop}
            contextUsage={contextUsage}
          />
        </form>

        <ComposerStatus
          className={isDock ? 'pointer-events-auto' : undefined}
          modelsWarning={modelsWarning}
          runNotice={runNotice}
          runCacheHint={runCacheHint}
          running={running}
        />

        {!isDock ? (
        <p className="m-0 mt-4 text-center text-xs leading-relaxed tracking-[var(--vy-tracking)] text-muted">
          {HERO_HINT}
        </p>
        ) : null}
      </div>
    </div>
  )
}

export { buildUserContent }
