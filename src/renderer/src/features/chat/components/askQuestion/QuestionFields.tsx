import type { JSX } from 'react'
import { cn } from '@renderer/lib/ui'
import type { UiAgentQuestionItem } from '@shared/transcript'

const OPTION_BASE =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm vy-transition disabled:opacity-[var(--vy-disabled-opacity)]'
const OPTION_IDLE = 'text-secondary hover:bg-surface hover:text-fg'
const OPTION_ACTIVE = 'bg-accent/10 text-fg'

export type QuestionFieldProps = {
  item: UiAgentQuestionItem
  values: string[]
  customText: string
  disabled?: boolean
  promptId: string
  onChange: (values: string[], customText: string) => void
}

function OptionMark({
  kind,
  active
}: {
  kind: 'radio' | 'check'
  active: boolean
}): JSX.Element {
  return (
    <span
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center border border-border',
        kind === 'radio' ? 'rounded-full' : 'rounded-sm',
        active && 'border-accent bg-accent'
      )}
      aria-hidden
    >
      {active ? (
        <span
          className={cn(
            'bg-accent-fg',
            kind === 'radio' ? 'h-1.5 w-1.5 rounded-full' : 'h-1.5 w-1.5'
          )}
        />
      ) : null}
    </span>
  )
}

function CustomOther({
  value,
  disabled,
  onChange
}: {
  value: string
  disabled?: boolean
  onChange: (text: string) => void
}): JSX.Element {
  return (
    <input
      type="text"
      className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg"
      placeholder="Other…"
      aria-label="Other answer"
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function optionSelections(
  options: string[],
  values: string[],
  customText: string
): string[] {
  const custom = customText.trim()
  const selected = options.filter((o) => values.includes(o))
  return custom ? [...selected, custom] : selected
}

export function SingleChoiceField({
  item,
  values,
  customText,
  disabled,
  promptId,
  onChange
}: QuestionFieldProps): JSX.Element {
  const selected = values[0] ?? ''
  const options = item.options ?? []
  const allowCustom = item.allowCustom === true
  const customActive = allowCustom && customText.trim().length > 0

  return (
    <div role="radiogroup" aria-labelledby={promptId} className="flex flex-col gap-0.5">
      {options.map((option) => {
        const active = !customActive && selected === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={cn(OPTION_BASE, active ? OPTION_ACTIVE : OPTION_IDLE)}
            onClick={() => onChange([option], '')}
          >
            <OptionMark kind="radio" active={active} />
            <span className="min-w-0">{option}</span>
          </button>
        )
      })}
      {allowCustom ? (
        <CustomOther
          value={customText}
          disabled={disabled}
          onChange={(text) => {
            const trimmed = text.trim()
            onChange(trimmed ? [trimmed] : [], text)
          }}
        />
      ) : null}
    </div>
  )
}

export function MultiChoiceField({
  item,
  values,
  customText,
  disabled,
  promptId,
  onChange
}: QuestionFieldProps): JSX.Element {
  const options = item.options ?? []
  const allowCustom = item.allowCustom === true
  const selected = new Set(options.filter((o) => values.includes(o)))

  return (
    <div role="group" aria-labelledby={promptId} className="flex flex-col gap-0.5">
      {options.map((option) => {
        const active = selected.has(option)
        return (
          <button
            key={option}
            type="button"
            role="checkbox"
            aria-checked={active}
            disabled={disabled}
            className={cn(OPTION_BASE, active ? OPTION_ACTIVE : OPTION_IDLE)}
            onClick={() => {
              const next = new Set(selected)
              if (next.has(option)) next.delete(option)
              else next.add(option)
              onChange(
                optionSelections(options, [...next], customText),
                customText
              )
            }}
          >
            <OptionMark kind="check" active={active} />
            <span className="min-w-0">{option}</span>
          </button>
        )
      })}
      {allowCustom ? (
        <CustomOther
          value={customText}
          disabled={disabled}
          onChange={(text) => {
            onChange(optionSelections(options, values, text), text)
          }}
        />
      ) : null}
    </div>
  )
}

export function BooleanField({
  values,
  disabled,
  promptId,
  onChange
}: QuestionFieldProps): JSX.Element {
  const selected = values[0] ?? ''
  return (
    <div role="radiogroup" aria-labelledby={promptId} className="flex gap-1.5">
      {(['Yes', 'No'] as const).map((option) => {
        const active = selected === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={cn(
              'min-w-[4.5rem] rounded-md border px-3 py-1.5 text-sm vy-transition disabled:opacity-[var(--vy-disabled-opacity)]',
              active
                ? 'border-accent bg-accent/10 text-fg'
                : 'border-border text-secondary hover:bg-surface'
            )}
            onClick={() => onChange([option], '')}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

export function TextField({
  values,
  disabled,
  promptId,
  onChange
}: QuestionFieldProps): JSX.Element {
  return (
    <textarea
      id={`${promptId}-input`}
      className="min-h-[64px] w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg"
      placeholder="Your answer…"
      aria-labelledby={promptId}
      disabled={disabled}
      value={values[0] ?? ''}
      onChange={(e) => onChange(e.target.value ? [e.target.value] : [], '')}
    />
  )
}

export function QuestionField(props: QuestionFieldProps): JSX.Element {
  switch (props.item.type) {
    case 'single':
      return <SingleChoiceField {...props} />
    case 'multi':
      return <MultiChoiceField {...props} />
    case 'boolean':
      return <BooleanField {...props} />
    case 'text':
      return <TextField {...props} />
  }
}
