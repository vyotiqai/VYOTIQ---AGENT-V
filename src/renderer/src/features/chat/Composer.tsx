import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import { Icon } from '../../shared/icons'
import { Menu, IconButton, ImageChip, Textarea, ActionMenu, cn, type MenuOption } from '../../shared/ui'
import { ActivityToggle } from './ActivityPanel'
import { useEscapeToClose } from '../../shared/hooks/useEscapeToClose'
import { PROVIDER_DEFAULTS, seedModelsFor, ollamaOpenAiBaseUrl } from '@shared/providers'
import type { ModelInfo, ProviderId } from '@shared/ipc'
import { MAX_IMAGE_BYTES, buildUserContent } from '@shared/ipc'
import { logger } from '@shared/logger'

const MAX_IMAGES = 4

function seedOptions(): MenuOption[] {
  const options: MenuOption[] = []
  for (const p of PROVIDER_DEFAULTS) {
    for (const m of p.models) {
      options.push({
        value: `${p.id}::${m}`,
        label: m,
        group: p.label
      })
    }
  }
  return options
}

const SEED_OPTIONS = seedOptions()

function filterSeedOptions(
  options: MenuOption[],
  opts: { hasWorkspace: boolean; hasImages: boolean }
): MenuOption[] {
  const { hasWorkspace, hasImages } = opts
  if (!hasWorkspace && !hasImages) return options
  return options.filter((opt) => {
    const [provider, ...rest] = opt.value.split('::')
    const modelId = rest.join('::')
    const info = seedModelsFor(provider as ProviderId).find((m) => m.id === modelId)
    if (!info) return true
    if (hasWorkspace && !info.supportsTools) return false
    if (hasImages && !(info.supportsVision || info.inputModalities.includes('image'))) return false
    return true
  })
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

const iconCtl =
  'inline-grid size-7 place-items-center rounded-full text-muted vy-transition hover:bg-surface hover:text-fg disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)] disabled:hover:bg-transparent disabled:hover:text-muted'

export function Composer({
  provider,
  model,
  running,
  disabled,
  workspaceLabel,
  hasWorkspace,
  hasTranscript,
  ollamaBaseUrl,
  modelsRefreshKey,
  onPickWorkspace,
  onProviderModel,
  onSend,
  onStop,
  activityOpen,
  onToggleActivity
}: {
  provider: ProviderId
  model: string
  running: boolean
  disabled?: boolean
  workspaceLabel?: string
  hasWorkspace?: boolean
  hasTranscript?: boolean
  ollamaBaseUrl?: string
  /** Bumps when API key / secrets change so catalog reloads without remounting. */
  modelsRefreshKey?: string | number
  onPickWorkspace?: () => void
  onProviderModel: (provider: ProviderId, model: string) => void
  onSend: (text: string, images?: string[]) => boolean | void | Promise<boolean | void>
  onStop: () => void
  activityOpen?: boolean
  onToggleActivity?: () => void
}) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [plusOpen, setPlusOpen] = useState(false)
  const [liveModels, setLiveModels] = useState<ModelInfo[] | null>(null)
  const [modelsWarning, setModelsWarning] = useState<string | null>(null)
  const plusBtnRef = useRef<HTMLButtonElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const defaults = PROVIDER_DEFAULTS.find((p) => p.id === provider)
  const value = `${provider}::${model}`
  const locked = Boolean(disabled || running)

  const hasImages = images.length > 0
  const catalog =
    liveModels && liveModels.length > 0 ? liveModels : seedModelsFor(provider)
  const filtered = catalog.filter((m) => {
    if (hasWorkspace && !m.supportsTools) return false
    if (hasImages && !(m.supportsVision || m.inputModalities.includes('image'))) return false
    return true
  })

  const options: MenuOption[] = (() => {
    if (!liveModels?.length) {
      let base = filterSeedOptions(SEED_OPTIONS, {
        hasWorkspace: Boolean(hasWorkspace),
        hasImages
      })
      if (defaults && !defaults.models.includes(model)) {
        base = [...base, { value, label: model, group: defaults.label }]
      }
      return base
    }
    const byProvider = new Map<ProviderId, ModelInfo[]>()
    // Prefer live filtered list; never fall back to non-vision models when images are attached
    for (const p of PROVIDER_DEFAULTS) {
      if (p.id === provider) {
        byProvider.set(p.id, hasImages ? filtered : filtered.length ? filtered : catalog)
      } else {
        byProvider.set(p.id, seedModelsFor(p.id))
      }
    }
    const opts: MenuOption[] = []
    for (const p of PROVIDER_DEFAULTS) {
      const models = byProvider.get(p.id) ?? []
      for (const m of models) {
        opts.push({
          value: `${p.id}::${m.id}`,
          label: m.displayName ?? m.id,
          group: p.label
        })
      }
    }
    if (!opts.some((o) => o.value === value)) {
      opts.push({ value, label: model, group: defaults?.label ?? provider })
    }
    return opts
  })()

  const canSend = (Boolean(text.trim()) || images.length > 0) && !disabled && !running

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!window.vyotiq?.listModels) {
        setLiveModels(null)
        return
      }
      const res = await window.vyotiq.listModels({
        provider,
        baseUrl:
          provider === 'ollama' && ollamaBaseUrl
            ? ollamaOpenAiBaseUrl(ollamaBaseUrl)
            : undefined
      })
      if (cancelled) return
      if (res.ok) {
        setLiveModels(res.data.models)
        setModelsWarning(res.data.warning ?? null)
      } else {
        logger.warn('listModels failed', {
          scope: 'composer',
          err: res.error
        })
        setLiveModels(null)
        setModelsWarning(res.error)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [provider, ollamaBaseUrl, modelsRefreshKey])

  // If images are attached and the current model cannot see them, switch to a vision-capable option.
  useEffect(() => {
    if (!hasImages || running) return
    const currentOk = catalog.some(
      (m) =>
        m.id === model && (m.supportsVision || m.inputModalities.includes('image'))
    )
    if (currentOk) return
    const fallback = filtered[0]
    if (fallback && fallback.id !== model) {
      onProviderModel(provider, fallback.id)
    }
  }, [hasImages, running, catalog, filtered, model, provider, onProviderModel])

  useEscapeToClose(
    () => {
      setPlusOpen(false)
      plusBtnRef.current?.focus()
    },
    plusOpen,
    { capture: true }
  )

  useEffect(() => {
    if (locked) setPlusOpen(false)
  }, [locked])

  const plusActions = [
    {
      id: 'workspace',
      label: 'Workspace',
      icon: 'folder' as const,
      onSelect: () => {
        setPlusOpen(false)
        onPickWorkspace?.()
      }
    }
  ]

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    if ((!text.trim() && images.length === 0) || running || disabled) return
    const draftText = text
    const draftImages = images
    // Clear immediately for snappy UX; restore if chatStart fails.
    setText('')
    setImages([])
    setImageError(null)
    void Promise.resolve(onSend(draftText, draftImages.length ? draftImages : undefined)).then(
      (ok) => {
        if (ok === false) {
          setText(draftText)
          setImages(draftImages)
        }
      },
      () => {
        setText(draftText)
        setImages(draftImages)
      }
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const onPickImages = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      setImageError(`You can attach up to ${MAX_IMAGES} images.`)
      return
    }

    const next: string[] = []
    let skippedSize = 0
    let skippedRead = 0
    let skippedCap = 0
    let considered = 0

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      considered += 1
      if (next.length >= room) {
        skippedCap += 1
        continue
      }
      if (file.size > MAX_IMAGE_BYTES) {
        skippedSize += 1
        continue
      }
      try {
        next.push(await readFileAsDataUrl(file))
      } catch {
        skippedRead += 1
      }
    }

    const parts: string[] = []
    if (skippedSize > 0) {
      parts.push(
        `Skipped ${skippedSize} image${skippedSize > 1 ? 's' : ''} over ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB`
      )
    }
    if (skippedRead > 0) {
      parts.push(`Could not read ${skippedRead} image${skippedRead > 1 ? 's' : ''}`)
    }
    if (skippedCap > 0) {
      parts.push(`Only ${MAX_IMAGES} images allowed`)
    }
    if (considered === 0) {
      parts.push('No image files found')
    }
    setImageError(parts.length ? parts.join(' · ') : null)
    if (next.length) setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES))
  }

  return (
    <div className="shrink-0 px-3 pb-2 pt-1 sm:px-5">
      <form onSubmit={submit}>
        {images.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1">
            {images.map((url, i) => (
              <ImageChip
                key={`${i}-${url.slice(0, 24)}`}
                url={url}
                label={`img ${i + 1}`}
                variant="compact"
                disabled={running}
                onRemove={() => {
                  setImages((prev) => prev.filter((_, j) => j !== i))
                  setImageError(null)
                }}
              />
            ))}
          </div>
        ) : null}
        {imageError ? (
          <p className="mb-1.5 px-1 text-xs text-secondary" role="status">
            {imageError}
          </p>
        ) : null}

        <div className="relative flex min-h-[42px] flex-wrap items-end gap-0.5 rounded-pill border border-border bg-composer px-1.5 py-1 focus-within:vy-focus-ring">
          <ActionMenu
            open={plusOpen}
            onOpenChange={setPlusOpen}
            aria-label="Composer actions"
            placement="up"
            items={plusActions}
            trigger={({ ref, onClick, ...aria }) => (
              <button
                ref={(node) => {
                  ref.current = node
                  plusBtnRef.current = node
                }}
                type="button"
                className={cn(
                  'mb-0.5 inline-grid size-8 shrink-0 place-items-center rounded-full text-muted vy-transition hover:bg-surface hover:text-fg',
                  'disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)] disabled:hover:bg-transparent disabled:hover:text-muted'
                )}
                aria-label="Add"
                disabled={locked}
                onClick={onClick}
                {...aria}
              >
                <Icon name="plus" size={15} />
              </button>
            )}
          />

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

            <Textarea
            ref={taRef}
            className="mb-0.5 min-w-[8rem] flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={hasTranscript ? 'Send follow-up' : 'Send a message'}
            aria-label="Message"
            disabled={disabled}
          />

          <div className="mb-0.5 flex shrink-0 items-center gap-0.5">
            {onToggleActivity ? (
              <ActivityToggle
                open={Boolean(activityOpen)}
                disabled={locked}
                onToggle={onToggleActivity}
              />
            ) : null}
            <button
              type="button"
              className={iconCtl}
              aria-label={
                images.length >= MAX_IMAGES
                  ? `Attach image (limit ${MAX_IMAGES})`
                  : 'Attach image'
              }
              title={
                images.length >= MAX_IMAGES
                  ? `Up to ${MAX_IMAGES} images`
                  : 'Attach image'
              }
              disabled={locked || images.length >= MAX_IMAGES}
              onClick={() => {
                if (images.length >= MAX_IMAGES) {
                  setImageError(`You can attach up to ${MAX_IMAGES} images.`)
                  return
                }
                fileRef.current?.click()
              }}
            >
              <Icon name="image" size={13} />
            </button>
            <Menu
              aria-label="Model"
              className="min-w-0"
              value={value}
              options={options}
              disabled={running}
              searchPlaceholder="Search models"
              onChange={(next) => {
                const [p, ...rest] = next.split('::')
                const m = rest.join('::')
                onProviderModel(p as ProviderId, m)
              }}
            />
            {running ? (
              <IconButton
                icon="stop"
                label="Stop"
                size="sm"
                variant="primary"
                className="rounded-full"
                onClick={onStop}
              />
            ) : (
              <button
                type="submit"
                className={cn(
                  'inline-grid size-7 place-items-center rounded-full vy-transition disabled:cursor-not-allowed',
                  canSend
                    ? 'bg-accent text-accent-fg hover:bg-fg-strong'
                    : 'bg-transparent text-border-strong'
                )}
                aria-label="Send"
                disabled={!canSend}
              >
                <Icon name="send" size={12} />
              </button>
            )}
          </div>
        </div>
      </form>

      <div className="mt-1.5 flex items-center justify-between gap-3 px-2">
        <button
          type="button"
          className="inline-flex max-w-[55%] items-center gap-1.5 truncate text-xs tracking-[var(--vy-tracking)] text-muted vy-transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)]"
          onClick={() => onPickWorkspace?.()}
          title={workspaceLabel ?? 'Workspace'}
          aria-label={
            workspaceLabel ? `Workspace: ${workspaceLabel}. Change workspace` : 'Choose workspace'
          }
          disabled={running}
        >
          <Icon name="monitor" size={11} className="text-muted" />
          <span className="truncate">{workspaceLabel ?? 'Workspace'}</span>
          <Icon name="chevron" size={9} className="text-muted" />
        </button>
        {modelsWarning ? (
          <p
            className="m-0 max-w-[45%] truncate text-right text-xs tracking-[var(--vy-tracking)] text-muted"
            role="status"
          >
            <span className="sr-only">{modelsWarning}</span>
            <span aria-hidden>{modelsWarning}</span>
          </p>
        ) : running ? (
          <span
            className="inline-flex items-center gap-1.5 text-xs tracking-[var(--vy-tracking)] text-muted"
            role="status"
            aria-live="polite"
          >
            <span
              className="size-2 shrink-0 rounded-full border border-muted bg-surface-2 animate-pulse"
              aria-hidden
            />
            <span className="sr-only">Working</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** Re-export shared helper for tests / local imports. */
export { buildUserContent }
