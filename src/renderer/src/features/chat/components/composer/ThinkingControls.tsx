import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/ui/cn'
import { useDropdownMenu } from '@renderer/lib/hooks/useDropdownMenu'
import type { ProviderId, ThinkingEffort } from '@shared/ipc'
import type { ChatSettingsPatch, EffectiveChatSettings } from '@shared/effectiveSettings'
import { modelSupportsThinking } from '@shared/reasoning'

const EFFORT_OPTIONS: { value: ThinkingEffort; label: string; short: string }[] = [
  { value: 'minimal', label: 'Minimal', short: 'min' },
  { value: 'low', label: 'Low', short: 'low' },
  { value: 'medium', label: 'Medium', short: 'med' },
  { value: 'high', label: 'High', short: 'high' },
  { value: 'xhigh', label: 'Extra high', short: 'xhigh' },
  { value: 'max', label: 'Max', short: 'max' }
]

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
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const { position, close } = useDropdownMenu({
    open,
    onOpenChange: setOpen,
    triggerRef,
    panelRef,
    placement: 'up',
    align: 'start',
    disabled
  })

  const closePanel = useCallback(() => close(false), [close])

  if (!modelSupportsThinking(model, provider)) return null
  if (running) return null

  const effortShort =
    EFFORT_OPTIONS.find((o) => o.value === chatSettings.thinkingEffort)?.short ??
    chatSettings.thinkingEffort

  const label = chatSettings.thinkingEnabled ? `Thinking · ${effortShort}` : 'Thinking'

  const panel =
    open && position
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Thinking settings"
            className="fixed z-dropdown w-52 rounded-lg border border-border bg-card p-3 shadow-menu animate-fade-in"
            style={{
              top: position.placement === 'up' ? undefined : position.top,
              bottom:
                position.placement === 'up' ? window.innerHeight - position.top : undefined,
              left: position.left
            }}
          >
            <label className="flex cursor-pointer items-center justify-between gap-2 py-1">
              <span className="text-xs text-fg">Extended thinking</span>
              <input
                type="checkbox"
                className="size-3.5 accent-fg"
                checked={chatSettings.thinkingEnabled}
                disabled={disabled}
                onChange={(e) => onChatSettingsChange({ thinkingEnabled: e.target.checked })}
              />
            </label>
            <p className="mb-2 mt-1 text-[10px] text-muted">Effort</p>
            <div className="flex flex-wrap gap-1">
              {EFFORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={disabled || !chatSettings.thinkingEnabled}
                  className={cn(
                    'rounded-md px-2 py-1 text-[10px] vy-transition disabled:opacity-[var(--vy-disabled-opacity)]',
                    chatSettings.thinkingEffort === o.value
                      ? 'bg-surface-2 text-fg-strong'
                      : 'text-muted hover:bg-surface'
                  )}
                  onClick={() => {
                    onChatSettingsChange({ thinkingEffort: o.value })
                    closePanel()
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <div className={cn('relative shrink-0', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label="Thinking settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'inline-flex max-w-[10rem] min-h-8 items-center gap-1 rounded-full px-2.5 text-xs text-muted vy-transition',
          'hover:bg-surface hover:text-fg disabled:opacity-[var(--vy-disabled-opacity)]',
          chatSettings.thinkingEnabled && 'text-fg'
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{label}</span>
      </button>
      {panel}
    </div>
  )
}
