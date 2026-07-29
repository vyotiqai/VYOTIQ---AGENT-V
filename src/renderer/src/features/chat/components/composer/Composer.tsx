import { useCallback, useEffect, useRef, useState } from 'react'
import type { AttachedFile, ProviderId, ServiceTier, SlashCommandDescriptor } from '@shared/ipc'
import { buildUserContent } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { triggerKey } from '@shared/slashCommands'
import { Alert, cn } from '@renderer/lib/ui'
import { CHAT_COLUMN, CHAT_GUTTER, FLOATING_CHROME, FLOATING_CHROME_SHADOW_BOTTOM } from '@renderer/lib/utils/layout'
import { ComposerTextarea } from './ComposerTextarea'
import { ComposerToolbar, type ComposerVariant } from './ComposerToolbar'
import { ComposerAttachments } from './ComposerAttachments'
import { ComposerStatus } from './ComposerStatus'
import { useComposerDraft } from './useComposerDraft'
import { useComposerImages, MAX_IMAGES } from './useComposerImages'
import { useComposerFiles, ATTACHMENT_ACCEPT, MAX_FILES, isImageFile } from './useComposerFiles'
import { useComposerModels } from './useComposerModels'
import { pickVisionFallback } from './composerModelUtils'
import { useWorkspaceHotUi } from '@renderer/lib/hooks/workspaceHotUiStore'
import { SlashCommandMenu } from './SlashCommandMenu'
import { useSlashCommands } from './useSlashCommands'
import {
  executeSlashResolveResult,
  type SlashClientHandlers
} from './slashCommandExecute'

const HERO_HINT =
  'Type / for commands — try /code-review, /compact, /create-rule'

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
  workspacePath,
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
  incomplete,
  onContinue,
  contextUsage,
  metaStore,
  onCompactContext,
  onDismissError,
  leading,
  trailing,
  variant = 'dock',
  className,
  slashHandlers
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
  /** When set, draft is read from the hot UI store (avoids App re-renders on keystrokes). */
  workspacePath?: string | null
  onProviderModel: (provider: ProviderId, model: string) => void
  favoriteModels?: string[]
  recentModels?: string[]
  serviceTier?: ServiceTier
  onToggleFavorite?: (provider: ProviderId, model: string) => void
  onServiceTierChange?: (tier: ServiceTier) => void
  chatSettings: EffectiveChatSettings
  onChatSettingsChange: (patch: ChatSettingsPatch) => void
  onSend: (
    text: string,
    images?: string[],
    files?: AttachedFile[]
  ) => boolean | void | Promise<boolean | void>
  onStop: () => void
  composerPlaceholder?: string
  bannerError?: string | null
  runNotice?: string | null
  incomplete?: import('@renderer/lib/hooks/createChatStreamController').IncompleteTurnState | null
  onContinue?: () => void
  contextUsage?: import('./ContextMeter').ContextUsageState | null
  /** Prefer over contextUsage prop so meter patches do not re-render Composer. */
  metaStore?: import('../../chatStores').ChatMetaStore
  onCompactContext?: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>
  onDismissError?: () => void
  /** Docked chrome floating just above the composer, e.g. the change pills. */
  leading?: React.ReactNode
  /** Docked chrome below the composer, e.g. the repository line. */
  trailing?: React.ReactNode
  variant?: ComposerVariant
  className?: string
  slashHandlers?: SlashClientHandlers
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const locked = Boolean(disabled || running)
  const hotUi = useWorkspaceHotUi(workspacePath)
  const resolvedDraft = workspacePath ? hotUi.composerDraft : (draft ?? '')
  const [cursor, setCursor] = useState(0)

  const syncCursor = useCallback((): void => {
    const el = taRef.current
    if (el) setCursor(el.selectionStart ?? 0)
  }, [])

  const {
    images,
    setImages,
    imageError,
    setImageError,
    onPickImages,
    removeImage
  } = useComposerImages()

  const {
    files,
    setFiles,
    fileError,
    setFileError,
    extracting,
    addFiles,
    removeFile
  } = useComposerFiles()

  const slash = useSlashCommands({
    workspacePath,
    text: resolvedDraft,
    cursor,
    enabled: !locked && Boolean(hasWorkspace),
    onListError: slashHandlers?.onNotice
  })

  const findCommandByTrigger = useCallback(
    (trigger: string): SlashCommandDescriptor | null => {
      const key = triggerKey(trigger)
      return slash.commands.find((c) => triggerKey(c.trigger) === key) ?? null
    },
    [slash.commands]
  )

  const resolveAndExecute = useCallback(
    async (
      command: SlashCommandDescriptor,
      trailingText: string,
      sendImages: string[],
      sendFiles: AttachedFile[]
    ): Promise<boolean> => {
      if (!window.vyotiq?.slashCommandsResolve) return false

      if (command.availability === 'not_installed' && command.packageId) {
        await slashHandlers?.onMarketplaceAction?.(command.packageId, 'install')
        await slash.reload()
        return false
      }
      if (command.availability === 'disabled' && command.packageId) {
        await slashHandlers?.onMarketplaceAction?.(command.packageId, 'enable')
        await slash.reload()
        return false
      }
      if (
        command.availability === 'disconnected' ||
        command.availability === 'needs_auth'
      ) {
        slashHandlers?.onOpenMarketplace?.(command.mcpServerId)
        return false
      }

      const res = await window.vyotiq.slashCommandsResolve({
        id: command.id,
        workspacePath: workspacePath ?? null,
        trailingText
      })
      if (!res.ok) {
        slashHandlers?.onNotice?.(res.error)
        return false
      }

      const outcome = await executeSlashResolveResult(res.data, {
        ...slashHandlers,
        onCompact: async () => {
          if (slashHandlers?.onCompact) await slashHandlers.onCompact()
          else if (onCompactContext) await onCompactContext()
        }
      })

      if (outcome === 'sent' && res.data.action === 'send') {
        const ok = await Promise.resolve(
          onSend(
            res.data.message,
            sendImages.length ? sendImages : undefined,
            sendFiles.length ? sendFiles : undefined
          )
        )
        return ok !== false
      }
      if (outcome === 'pending') {
        await slash.reload()
        return false
      }
      return true
    },
    [workspacePath, slashHandlers, onCompactContext, onSend, slash]
  )

  const onSlashAccept = useCallback(
    (command: SlashCommandDescriptor): void => {
      const token = slash.token
      const trailingForResolve = token?.trailingText ?? ''
      const snapshot = resolvedDraft
      if (token && onDraftChange) {
        const before = resolvedDraft.slice(0, token.start)
        const afterToken = resolvedDraft.slice(token.end).replace(/^\s+/, '')
        onDraftChange(`${before}${afterToken}`.trimStart())
      }

      void resolveAndExecute(command, trailingForResolve, images, files).then((ok) => {
        if (ok) {
          onDraftChange?.('')
          setImages([])
          setImageError(null)
          setFiles([])
          setFileError(null)
        } else {
          // Restore pre-strip draft on CTA / IPC failure / pending marketplace.
          onDraftChange?.(snapshot)
        }
      })
    },
    [
      slash.token,
      resolvedDraft,
      onDraftChange,
      resolveAndExecute,
      images,
      files,
      setImages,
      setImageError,
      setFiles,
      setFileError
    ]
  )

  const onSlashSubmit = useCallback(
    async (
      command: SlashCommandDescriptor,
      trailingText: string,
      sendImages: string[],
      sendFiles: AttachedFile[]
    ): Promise<boolean> => {
      return resolveAndExecute(command, trailingText, sendImages, sendFiles)
    },
    [resolveAndExecute]
  )

  const { text, setText, canSend, submit, onKeyDown } = useComposerDraft({
    draft: resolvedDraft,
    onDraftChange,
    images,
    setImages,
    setImageError,
    files,
    setFiles,
    setFileError,
    running,
    disabled,
    onSend,
    slashMenuOpen: slash.open,
    slashActiveCommand: slash.activeCommand,
    onSlashMove: slash.moveActive,
    onSlashDismiss: slash.dismiss,
    onSlashAccept,
    onSlashSubmit,
    findCommandByTrigger
  })

  const [refreshingCatalog, setRefreshingCatalog] = useState(false)
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
    catalog,
    filterOpts,
    refreshCatalog,
    catalogLoading: catalogFetchLoading
  } = useComposerModels({
    provider,
    model,
    ollamaBaseUrl,
    modelsRefreshKey,
    hasWorkspace,
    hasImages: images.length > 0,
    browsedProvider
  })

  const catalogLoading = catalogFetchLoading || refreshingCatalog

  const ensureVisionModel = (): void => {
    if (running) return
    const fallback = pickVisionFallback(catalog, model, {
      ...filterOpts,
      hasImages: true
    })
    if (fallback && fallback !== model) {
      onProviderModel(provider, fallback)
    }
  }

  const onPickAttachments = async (list: FileList | null): Promise<void> => {
    if (!list?.length) return
    const picked = Array.from(list)
    const imageFiles = picked.filter(isImageFile)
    const documents = picked.filter((file) => !isImageFile(file))
    if (imageFiles.length) {
      await onPickImages(imageFiles)
      ensureVisionModel()
    }
    if (documents.length) await addFiles(documents)
  }

  const isDock = variant === 'dock'

  return (
    <div
      className={cn(
        isDock
          ? 'pointer-events-none absolute inset-x-0 bottom-0 z-sticky bg-bg pb-3 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-8 before:bg-gradient-to-t before:from-bg before:to-transparent'
          : 'shrink-0 w-full pb-0 pt-0',
        isDock ? CHAT_GUTTER : '',
        className
      )}
      data-composer-dock={isDock ? true : undefined}
      data-composer-hero={!isDock ? true : undefined}
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

        {isDock ? leading : null}

        <form
          onSubmit={submit}
          className={cn(
            '@container relative grid gap-2 p-2.5',
            FLOATING_CHROME,
            FLOATING_CHROME_SHADOW_BOTTOM,
            isDock && 'pointer-events-auto'
          )}
          data-composer-shell
        >
          <input
            ref={fileRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              void onPickAttachments(e.target.files)
              e.target.value = ''
            }}
          />

          <ComposerAttachments
            images={images}
            imageError={imageError}
            files={files}
            fileError={fileError}
            extracting={extracting}
            running={running}
            onRemove={removeImage}
            onRemoveFile={removeFile}
          />

          <ComposerTextarea
            ref={taRef}
            className="col-span-full min-h-[32px] max-h-40 min-w-0 border-0 bg-transparent p-0 text-md leading-relaxed shadow-none focus-visible:ring-0"
            value={text}
            onChange={(next) => {
              setText(next)
              requestAnimationFrame(syncCursor)
            }}
            onKeyDown={(e) => {
              onKeyDown(e)
              requestAnimationFrame(syncCursor)
            }}
            onSelect={syncCursor}
            onClick={syncCursor}
            onKeyUp={syncCursor}
            placeholder={
              composerPlaceholder ?? (hasTranscript ? 'Send follow-up' : 'Send a message')
            }
            disabled={locked}
            aria-expanded={slash.open}
            aria-controls={slash.open ? 'slash-command-menu' : undefined}
            aria-autocomplete={slash.open ? 'list' : undefined}
            aria-activedescendant={
              slash.open && slash.activeCommand
                ? `slash-command-menu-opt-${slash.activeCommand.id}`
                : undefined
            }
          />

          <SlashCommandMenu
            open={slash.open}
            commands={slash.filtered}
            activeIndex={slash.activeIndex}
            onActiveIndexChange={slash.setActiveIndex}
            onPick={onSlashAccept}
            onDismiss={slash.dismiss}
            anchorRef={taRef}
            listId="slash-command-menu"
            loading={slash.loading}
            listError={slash.listError}
          />

          <ComposerToolbar
            variant={variant}
            disabled={disabled}
            locked={locked}
            imageCount={images.length}
            fileCount={files.length}
            onAttachClick={() => {
              if (images.length >= MAX_IMAGES && files.length >= MAX_FILES) {
                setImageError(`You can attach up to ${MAX_IMAGES} images and ${MAX_FILES} files.`)
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
              setRefreshingCatalog(true)
              void refreshCatalog({ forceRefresh: true, provider: browsedProvider }).finally(() =>
                setRefreshingCatalog(false)
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
            metaStore={metaStore}
            onCompactContext={onCompactContext}
          />
        </form>

        <ComposerStatus
          className={isDock ? 'pointer-events-auto' : undefined}
          modelsWarning={modelsWarning}
          runNotice={runNotice}
          incomplete={incomplete}
          onContinue={onContinue}
          running={running}
        />

        {isDock ? trailing : null}

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
