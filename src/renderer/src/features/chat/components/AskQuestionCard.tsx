import { memo, useMemo, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { TOOL_CARD_BODY, TOOL_CARD_HEADER, TOOL_CARD_SURFACE } from '@renderer/lib/utils/layout'
import type { UiAgentQuestion } from '@shared/transcript'

export const AskQuestionCard = memo(function AskQuestionCard({
  question,
  onSubmit
}: {
  question: UiAgentQuestion
  onSubmit?: (requestId: string, answers: string[]) => void | Promise<void>
}) {
  const [phase, setPhase] = useState<'idle' | 'pending' | 'done'>('idle')
  const [localError, setLocalError] = useState<string | null>(null)
  const hasOptions = Boolean(question.options?.length)
  const allowMultiple = question.allowMultiple === true
  const allowCustom = question.allowCustom !== false
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [customText, setCustomText] = useState('')

  const answers = useMemo(() => {
    const out = [...selected]
    const custom = customText.trim()
    if (allowCustom && custom) out.push(custom)
    return out
  }, [allowCustom, customText, selected])

  const toggleOption = (option: string): void => {
    if (phase !== 'idle') return
    setSelected((prev) => {
      const next = new Set(prev)
      if (allowMultiple) {
        if (next.has(option)) next.delete(option)
        else next.add(option)
        return next
      }
      return new Set([option])
    })
  }

  const submit = (): void => {
    if (phase !== 'idle' || !answers.length || !onSubmit) return
    setPhase('pending')
    setLocalError(null)
    void Promise.resolve(onSubmit(question.requestId, answers))
      .then(() => {
        setPhase('done')
      })
      .catch((err: unknown) => {
        setPhase('idle')
        setLocalError(err instanceof Error ? err.message : 'Could not send answer')
      })
  }

  const busy = phase !== 'idle'
  const canSubmit = Boolean(onSubmit) && answers.length > 0 && !busy
  const submitLabel =
    phase === 'pending' ? 'Sending…' : phase === 'done' ? 'Answered' : 'Submit answer'

  return (
    <div
      className={cn(TOOL_CARD_SURFACE, 'w-full border-accent/50')}
      role="group"
      aria-busy={phase === 'pending' ? true : undefined}
    >
      <div className={cn(TOOL_CARD_HEADER, 'flex items-center gap-2 text-fg')}>
        <Icon name="sparkles" size={14} className="shrink-0 text-accent" />
        <span className="font-medium">Question</span>
      </div>
      <div className={cn(TOOL_CARD_BODY, 'px-3 py-2 text-sm text-fg')}>{question.question}</div>
      {hasOptions ? (
        <div className={cn(TOOL_CARD_BODY, 'flex flex-col gap-1.5 px-3 py-2')}>
          {question.options!.map((option) => {
            const active = selected.has(option)
            return (
              <button
                key={option}
                type="button"
                disabled={busy}
                className={cn(
                  'rounded-md border px-2 py-1.5 text-left text-sm vy-transition disabled:opacity-[var(--vy-disabled-opacity)]',
                  active
                    ? 'border-accent bg-accent/10 text-fg'
                    : 'border-border text-secondary hover:bg-surface'
                )}
                aria-pressed={active}
                onClick={() => toggleOption(option)}
              >
                {option}
              </button>
            )
          })}
        </div>
      ) : null}
      {allowCustom || !hasOptions ? (
        <div className={cn(TOOL_CARD_BODY, 'px-3 py-2')}>
          <textarea
            className="min-h-[72px] w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            placeholder={hasOptions ? 'Or type a custom answer…' : 'Your answer…'}
            aria-label={hasOptions ? 'Custom answer' : 'Your answer'}
            disabled={busy}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
          />
        </div>
      ) : null}
      {localError ? (
        <p className="border-t border-border px-3 py-2 text-xs text-danger" role="alert">
          {localError}
        </p>
      ) : null}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          disabled={!canSubmit}
          className="rounded-md border border-accent bg-accent px-2 py-1 text-xs text-accent-fg vy-transition hover:opacity-90 disabled:opacity-[var(--vy-disabled-opacity)]"
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
})
