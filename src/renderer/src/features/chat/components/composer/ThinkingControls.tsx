import { useCallback } from 'react'
import { cn } from '@renderer/lib/ui/cn'
import type { ProviderId, ThinkingEffort } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { modelSupportsThinking } from '@shared/reasoning'

const EFFORT_OPTIONS: { value: ThinkingEffort; label: string; short: string }[] = [
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

const THINKING_MODES: ThinkingMode[] = [
  { enabled: false, effort: null, label: 'Off', short: 'Off' },
  ...EFFORT_OPTIONS.map((o) => ({
    enabled: true as const,
    effort: o.value,
    label: o.label,
    short: o.short
  }))
]

function modeIndex(enabled: boolean, effort: ThinkingEffort): number {
  if (!enabled) return 0
  const i = THINKING_MODES.findIndex((m) => m.enabled && m.effort === effort)
  return i >= 0 ? i : 1
}

function nextMode(index: number, reverse: boolean): ThinkingMode {
  const len = THINKING_MODES.length
  const next = reverse ? (index - 1 + len) % len : (index + 1) % len
  return THINKING_MODES[next]!
}

export function ThinkingControls({
  provider,
  model,
  chatSettings,
  onChatSettingsChange,
  disabled,
  running = false,
  className
}: {
  provider: ProviderId
  model: string
  chatSettings: EffectiveChatSettings
  onChatSettingsChange: (patch: ChatSettingsPatch) => void
  disabled?: boolean
  running?: boolean
  className?: string
}) {
  const advance = useCallback(
    (reverse: boolean) => {
      const i = modeIndex(chatSettings.thinkingEnabled, chatSettings.thinkingEffort)
      const next = nextMode(i, reverse)
      if (!next.enabled) {
        onChatSettingsChange({ thinkingEnabled: false })
        return
      }
      onChatSettingsChange({
        thinkingEnabled: true,
        thinkingEffort: next.effort
      })
    },
    [chatSettings.thinkingEnabled, chatSettings.thinkingEffort, onChatSettingsChange]
  )

  if (!modelSupportsThinking(model, provider)) return null
  if (running) return null

  const index = modeIndex(chatSettings.thinkingEnabled, chatSettings.thinkingEffort)
  const current = THINKING_MODES[index]!
  const upcoming = nextMode(index, false)
  const on = current.enabled

  const ariaLabel = on
    ? `Thinking ${current.label}. Click for ${upcoming.label}.`
    : `Thinking off. Click for ${upcoming.label}.`

  return (
    <div className={cn('relative flex h-7 shrink-0 items-center', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        title={`${ariaLabel} Shift-click for previous.`}
        className={cn(
          'inline-flex h-7 items-center rounded-xl px-1.5 text-[11px] leading-none tracking-[var(--vy-tracking)]',
          'vy-transition hover:bg-surface hover:text-fg active:bg-surface',
          'disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)]',
          on ? 'text-fg' : 'text-muted'
        )}
        onClick={(e) => {
          e.preventDefault()
          advance(e.shiftKey)
        }}
      >
        <span className="truncate">
          Think
          <span className={cn('text-tertiary', on && 'text-muted')}> · </span>
          <span className={on ? 'text-fg' : 'text-tertiary'}>{current.short}</span>
        </span>
      </button>
    </div>
  )
}
