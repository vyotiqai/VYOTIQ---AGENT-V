import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@renderer/lib/icons'
import { SearchInput } from '@renderer/lib/ui/SearchInput'
import { cn } from '@renderer/lib/ui/cn'
import { prefersReducedMotion } from '@renderer/lib/utils/motion'
import { useDropdownMenu } from '@renderer/lib/hooks/useDropdownMenu'
import type { ProviderId, ServiceTier } from '@shared/ipc'
import { PROVIDER_DEFAULTS } from '@shared/providers'
import { modelSelectionKey, parseModelSelectionKey } from '@shared/domain/modelSelection'
import {
  SERVICE_TIER_DESCRIPTIONS,
  SERVICE_TIER_LABELS
} from '@shared/domain/serviceTier'
import { ProviderLogo } from './ProviderLogo'
import {
  formatModelDisplayName,
  resolvePickerOption,
  supportedTiersForModel,
  type ModelPickerOption
} from './composerModelUtils'

const SESSION_TAB_KEY = 'vyotiq:model-picker-tab'

function readSessionTab(fallback: ProviderId, providers: ProviderId[]): ProviderId {
  try {
    const stored = sessionStorage.getItem(SESSION_TAB_KEY)
    if (stored && providers.includes(stored as ProviderId)) {
      return stored as ProviderId
    }
  } catch {
    // ignore
  }
  return fallback
}

const optionClass = cn(
  'flex w-full cursor-pointer items-center gap-2 rounded-xl bg-transparent px-2.5 py-1.5 text-left text-sm text-fg',
  'hover:bg-surface active:bg-surface-2',
  'vy-transition'
)

function CapabilityBadges({ meta }: { meta?: ModelPickerOption['meta'] }) {
  if (!meta) return null
  const badges: string[] = []
  if (meta.supportsThinking) badges.push('Think')
  if (meta.supportsVision) badges.push('Vision')
  if (meta.supportsTools) badges.push('Tools')
  if (!badges.length) return null
  return (
    <span className="flex shrink-0 gap-1">
      {badges.map((b) => (
        <span
          key={b}
          className="rounded px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted ring-1 ring-border"
        >
          {b}
        </span>
      ))}
    </span>
  )
}

function ModelRow({
  opt,
  selected,
  active,
  favorite,
  onSelect,
  onToggleFavorite,
  onHover,
  listId,
  index,
  optionRef
}: {
  opt: ModelPickerOption
  selected: boolean
  active: boolean
  favorite: boolean
  onSelect: () => void
  onToggleFavorite: () => void
  onHover: () => void
  listId: string
  index: number
  optionRef: (el: HTMLElement | null) => void
}) {
  const parsed = parseModelSelectionKey(opt.value)
  return (
    <li
      id={`${listId}-opt-${opt.value}`}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      ref={optionRef}
      className={cn(
        'group relative',
        optionClass,
        selected && 'bg-surface-2 text-fg-strong',
        active && !selected && 'bg-surface'
      )}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      {parsed ? (
        <ProviderLogo
          id={parsed.provider}
          subProvider={opt.subProvider}
          size="sm"
          className="text-muted"
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
      <CapabilityBadges meta={opt.meta} />
      <button
        type="button"
        className={cn(
          'shrink-0 rounded px-0.5 text-xs text-muted opacity-0 vy-transition group-hover:opacity-100',
          favorite && 'opacity-100 text-fg'
        )}
        aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite()
        }}
      >
        <Icon
          name="star"
          size={16}
          weight={favorite ? 'fill' : 'bold'}
        />
      </button>
      {selected ? (
        <Icon name="check" size={16} className="shrink-0 text-fg" />
      ) : (
        <span className="inline-block size-4 shrink-0" aria-hidden />
      )}
    </li>
  )
}

export function ModelPicker({
  providers,
  optionsByProvider,
  seedsByProvider,
  modelMetaByValue,
  provider,
  model,
  favoriteModels = [],
  recentModels = [],
  modelsWarning,
  serviceTier,
  onModelChange,
  onToggleFavorite,
  onServiceTierChange,
  onRefreshCatalog,
  onBrowseProvider,
  catalogLoading,
  disabled,
  className,
  triggerClassName
}: {
  providers: ProviderId[]
  optionsByProvider: Record<ProviderId, ModelPickerOption[]>
  seedsByProvider: Record<ProviderId, ModelPickerOption[]>
  modelMetaByValue: Record<string, import('@shared/ipc').ModelInfo>
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
  disabled?: boolean
  className?: string
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [browsedProvider, setBrowsedProvider] = useState<ProviderId>(provider)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLElement | null>>([])
  const listId = useId()
  const panelId = useId()

  const modelValue = modelSelectionKey(provider, model)
  const providerMeta = PROVIDER_DEFAULTS.find((p) => p.id === provider)
  const displayName =
    optionsByProvider[provider]?.find((o) => o.value === modelValue)?.label ??
    formatModelDisplayName(model)

  const supportedTiers = supportedTiersForModel(
    provider,
    model,
    modelMetaByValue[modelValue]
  )

  const { position, close } = useDropdownMenu({
    open,
    onOpenChange: setOpen,
    triggerRef,
    panelRef,
    placement: 'up',
    align: 'start',
    disabled
  })

  useEffect(() => {
    if (!open) return
    const tab = readSessionTab(provider, providers)
    setBrowsedProvider(tab)
    onBrowseProvider?.(tab)
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open, provider, providers, onBrowseProvider])

  const selectBrowsedProvider = useCallback(
    (next: ProviderId) => {
      setBrowsedProvider(next)
      onBrowseProvider?.(next)
      try {
        sessionStorage.setItem(SESSION_TAB_KEY, next)
      } catch {
        // ignore
      }
    },
    [onBrowseProvider]
  )

  const globalSearchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const hits: ModelPickerOption[] = []
    for (const p of providers) {
      for (const opt of optionsByProvider[p] ?? []) {
        if (
          opt.label.toLowerCase().includes(q) ||
          opt.value.toLowerCase().includes(q) ||
          (opt.group?.toLowerCase().includes(q) ?? false)
        ) {
          hits.push(opt)
        }
      }
    }
    return hits
  }, [query, providers, optionsByProvider])

  useEffect(() => {
    if (globalSearchResults?.length && query.trim()) {
      const first = parseModelSelectionKey(globalSearchResults[0].value)
      if (first) selectBrowsedProvider(first.provider)
    }
  }, [globalSearchResults, query, selectBrowsedProvider])

  const visibleOptions = useMemo(() => {
    if (globalSearchResults !== null) {
      return { mode: 'flat' as const, items: globalSearchResults }
    }
    const base = optionsByProvider[browsedProvider] ?? []
    const seedIds = new Set((seedsByProvider[browsedProvider] ?? []).map((o) => o.value))

    const favorites = favoriteModels
      .map((k) => resolvePickerOption(k, optionsByProvider, modelMetaByValue))
      .filter((o): o is ModelPickerOption => Boolean(o))
    const recent = recentModels
      .map((k) => resolvePickerOption(k, optionsByProvider, modelMetaByValue))
      .filter((o): o is ModelPickerOption => Boolean(o))
    const seeds = base.filter((o) => seedIds.has(o.value))
    const pinned = new Set([...favorites, ...recent, ...seeds].map((o) => o.value))
    const rest = base.filter((o) => !pinned.has(o.value))

    const sections: { header: string; items: ModelPickerOption[] }[] = []
    if (favorites.length) sections.push({ header: 'Favorites', items: favorites })
    if (recent.length) sections.push({ header: 'Recent', items: recent })
    if (seeds.length) sections.push({ header: 'Recommended', items: seeds })
    if (rest.length) sections.push({ header: 'All models', items: rest })
    return { mode: 'sections' as const, sections }
  }, [
    globalSearchResults,
    optionsByProvider,
    browsedProvider,
    favoriteModels,
    recentModels,
    seedsByProvider,
    modelMetaByValue
  ])

  const flatOptions = useMemo(() => {
    if (visibleOptions.mode === 'flat') return visibleOptions.items
    return visibleOptions.sections.flatMap((s) => s.items)
  }, [visibleOptions])

  const pickModel = useCallback(
    (value: string) => {
      const parsed = parseModelSelectionKey(value)
      if (!parsed) return
      onModelChange(parsed.provider, parsed.model)
    },
    [onModelChange]
  )

  const onListKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!flatOptions.length) return
      setActiveIndex((i) => (i < 0 ? 0 : (i + 1) % flatOptions.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!flatOptions.length) return
      setActiveIndex((i) =>
        i < 0 ? flatOptions.length - 1 : (i - 1 + flatOptions.length) % flatOptions.length
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = flatOptions[activeIndex]
      if (opt) pickModel(opt.value)
    }
  }

  const panel =
    open && position
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="listbox"
            aria-label="Select model"
            className="fixed z-dropdown flex max-h-[min(70vh,36rem)] w-[min(calc(100vw-1.5rem),24rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-menu animate-fade-in"
            style={{
              top: position.placement === 'up' ? undefined : position.top,
              bottom:
                position.placement === 'up' ? window.innerHeight - position.top : undefined,
              left: position.left,
              maxWidth: 384
            }}
            onKeyDown={onListKeyDown}
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <SearchInput
                  ref={searchRef}
                  inputClassName="min-h-7 text-xs"
                  placeholder="Search all models"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActiveIndex(0)
                  }}
                  aria-label="Search models"
                />
              </div>
              <button
                type="button"
                className="inline-grid size-7 shrink-0 place-items-center rounded-xl text-muted vy-transition hover:bg-surface hover:text-fg disabled:opacity-50"
                aria-label="Refresh model catalog"
                disabled={catalogLoading}
                onClick={() => onRefreshCatalog()}
              >
                <span className={cn('text-sm', catalogLoading && 'animate-spin')}>↻</span>
              </button>
            </div>

            {modelsWarning ? (
              <p className="m-0 shrink-0 border-b border-border bg-surface px-3 py-1.5 text-[10px] leading-snug text-muted">
                {modelsWarning}
              </p>
            ) : null}

            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
              {providers.map((p) => {
                const meta = PROVIDER_DEFAULTS.find((d) => d.id === p)
                const active = browsedProvider === p
                return (
                  <button
                    key={p}
                    type="button"
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-xl px-2 py-1 text-[10px] vy-transition',
                      active
                        ? 'bg-surface-2 text-fg-strong'
                        : 'text-muted hover:bg-surface hover:text-fg'
                    )}
                    aria-pressed={active}
                    onClick={() => selectBrowsedProvider(p)}
                  >
                    <ProviderLogo id={p} size="sm" />
                    <span>{meta?.label ?? p}</span>
                  </button>
                )
              })}
            </div>

            <ul
              id={listId}
              className="m-0 min-h-0 flex-1 list-none overflow-auto p-1"
              role="presentation"
            >
              {flatOptions.length === 0 ? (
                <li className="px-2.5 py-2 text-xs text-muted">No matches</li>
              ) : visibleOptions.mode === 'flat' ? (
                flatOptions.map((opt, index) => (
                  <ModelRow
                    key={opt.value}
                    opt={opt}
                    selected={opt.value === modelValue}
                    active={index === activeIndex}
                    favorite={favoriteModels.includes(opt.value)}
                    onSelect={() => pickModel(opt.value)}
                    onHover={() => setActiveIndex(index)}
                    onToggleFavorite={() => {
                      const parsed = parseModelSelectionKey(opt.value)
                      if (parsed) onToggleFavorite(parsed.provider, parsed.model)
                    }}
                    listId={listId}
                    index={index}
                    optionRef={(el) => {
                      optionRefs.current[index] = el
                    }}
                  />
                ))
              ) : (
                visibleOptions.sections.map((section) => (
                  <li key={section.header} role="presentation">
                    <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                      {section.header}
                    </div>
                    <ul className="m-0 list-none p-0" role="group" aria-label={section.header}>
                      {section.items.map((opt) => {
                        const index = flatOptions.findIndex((o) => o.value === opt.value)
                        return (
                          <ModelRow
                            key={opt.value}
                            opt={opt}
                            selected={opt.value === modelValue}
                            active={index === activeIndex}
                            favorite={favoriteModels.includes(opt.value)}
                            onSelect={() => pickModel(opt.value)}
                            onHover={() => setActiveIndex(index)}
                            onToggleFavorite={() => {
                              const parsed = parseModelSelectionKey(opt.value)
                              if (parsed) onToggleFavorite(parsed.provider, parsed.model)
                            }}
                            listId={listId}
                            index={index}
                            optionRef={(el) => {
                              optionRefs.current[index] = el
                            }}
                          />
                        )
                      })}
                    </ul>
                  </li>
                ))
              )}
            </ul>

            {supportedTiers.length > 0 ? (
              <div className="shrink-0 border-t border-border px-3 py-2">
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                  Speed
                </p>
                <div className="flex flex-wrap gap-1">
                  {supportedTiers.map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      className={cn(
                        'rounded-xl px-2 py-1 text-xs vy-transition',
                        serviceTier === tier
                          ? 'bg-surface-2 text-fg-strong'
                          : 'text-muted hover:bg-surface hover:text-fg'
                      )}
                      title={SERVICE_TIER_DESCRIPTIONS[tier]}
                      onClick={() => onServiceTierChange(tier)}
                    >
                      {SERVICE_TIER_LABELS[tier]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>,
          document.body
        )
      : null

  return (
    <div className={cn('relative flex h-7 min-w-0 items-center', className)}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label="Select model"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`${providerMeta?.label ?? provider} · ${displayName}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <ProviderLogo id={provider} size="sm" className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate">{displayName}</span>
        <Icon
          name="chevron"
          size={12}
          className={cn('shrink-0 text-muted vy-transition', open && 'rotate-180')}
        />
      </button>
      {panel}
    </div>
  )
}
