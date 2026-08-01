import { useCallback, useMemo } from 'react'
import { cn } from '@renderer/lib/ui/cn'
import type { ModelInfo, ProviderId, ThinkingEffort } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { modelSupportsThinking } from '@shared/reasoning'
import { chromePillButton } from './composerChrome'

const ALL_EFFORT_OPTIONS: { value: ThinkingEffort; label: string; short: string }[] = [
  { value: 'minimal', label: 'Minimal', short: 'Min' },
  { value: 'low', label: 'Low', short: 'Low' },
  { value: 'medium', label: 'Medium', short: 'Med' },
  { value: 'high', label: 'High', short: 'High' },
  { value: 'xhigh', label: 'Extra high', short: 'XHigh' },
  { value: 'max', label: 'Max', short: 'Max' }
]

type ThinkingMode =
  | { enabled: false; effort: ThinkingEffort | null; label: string; short: string }
  | { enabled: true; effort: ThinkingEffort; label: string; short: string }

function buildModes(
  allowed: readonly ThinkingEffort[] | undefined,
  canDisable: boolean
): ThinkingMode[] {
  const options =
    allowed && allowed.length > 0
      ? ALL_EFFORT_OPTIONS.filter((o) => allowed.includes(o.value))
      : ALL_EFFORT_OPTIONS
  const effortModes: ThinkingMode[] = options.map((o) => ({
    enabled: true as const,
    effort: o.value,
    label: o.label,
    short: o.short
  }))
  if (!canDisable) return effortModes
  return [{ enabled: false, effort: null, label: 'Off', short: 'Off' }, ...effortModes]
}

function modeIndex(modes: ThinkingMode[], enabled: boolean, effort: ThinkingEffort): number {
  if (!enabled) {
    const off = modes.findIndex((m) => !m.enabled)
    return off >= 0 ? off : 0
  }
  const i = modes.findIndex((m) => m.enabled && m.effort === effort)
  if (i >= 0) return i
  const firstOn = modes.findIndex((m) => m.enabled)
  return firstOn >= 0 ? firstOn : 0
}

function nextMode(modes: ThinkingMode[], index: number, reverse: boolean): ThinkingMode {
  const len = modes.length
  const next = reverse ? (index - 1 + len) % len : (index + 1) % len
  return modes[next]!
}

/** Catalog true wins; explicit false hides; missing meta/field falls back to ID heuristic. */
export function modelShowsThinkingControls(
  provider: ProviderId,
  model: string,
  modelMeta?: ModelInfo | null
): boolean {
  if (modelMeta?.supportsThinking === true) return true
  if (modelMeta?.supportsThinking === false) return false
  return modelSupportsThinking(model, provider)
}

export function ThinkingControls({
  provider,
  model,
  modelMeta,
  chatSettings,
  onChatSettingsChange,
  disabled,
  running = false,
  className
}: {
  provider: ProviderId
  model: string
  /** Catalog ModelInfo when available; drives visibility and allowed efforts. */
  modelMeta?: ModelInfo | null
  chatSettings: EffectiveChatSettings
  onChatSettingsChange: (patch: ChatSettingsPatch) => void
  disabled?: boolean
  running?: boolean
  className?: string
}) {
  const canDisable = modelMeta?.thinkingCanDisable !== false
  const modes = useMemo(
    () => buildModes(modelMeta?.supportedThinkingEfforts, canDisable),
    [modelMeta?.supportedThinkingEfforts, canDisable]
  )

  const advance = useCallback(
    (reverse: boolean) => {
      const i = modeIndex(modes, chatSettings.thinkingEnabled, chatSettings.thinkingEffort)
      const next = nextMode(modes, i, reverse)
      if (!next.enabled) {
        onChatSettingsChange({ thinkingEnabled: false })
        return
      }
      onChatSettingsChange({
        thinkingEnabled: true,
        thinkingEffort: next.effort
      })
    },
    [modes, chatSettings.thinkingEnabled, chatSettings.thinkingEffort, onChatSettingsChange]
  )

  if (!modelShowsThinkingControls(provider, model, modelMeta)) return null

  const locked = Boolean(disabled || running)
  const index = modeIndex(modes, chatSettings.thinkingEnabled, chatSettings.thinkingEffort)
  const current = modes[index]!
  const upcoming = nextMode(modes, index, false)
  const on = current.enabled

  const ariaLabel = running
    ? on
      ? `Thinking ${current.label} (locked while running)`
      : 'Thinking off (locked while running)'
    : on
      ? `Thinking ${current.label}. Click for ${upcoming.label}.`
      : `Thinking off. Click for ${upcoming.label}.`

  return (
    <div className={cn('relative flex h-7 shrink-0 items-center', className)}>
      <button
        type="button"
        disabled={locked}
        aria-label={ariaLabel}
        title={running ? ariaLabel : `${ariaLabel} Shift-click for previous.`}
        className={cn(chromePillButton, 'gap-0', on ? 'text-fg' : 'text-muted')}
        onClick={(e) => {
          e.preventDefault()
          if (locked) return
          advance(e.shiftKey)
        }}
      >
        <span className="inline-flex min-w-0 items-center leading-tight">
          Think
          <span className={cn('text-tertiary', on && 'text-muted')}> · </span>
          <span className={on ? 'text-fg' : 'text-tertiary'}>{current.short}</span>
        </span>
      </button>
    </div>
  )
}
