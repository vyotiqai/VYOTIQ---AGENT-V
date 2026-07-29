import { forwardRef, type KeyboardEvent, type RefObject, type TextareaHTMLAttributes } from 'react'
import { Textarea } from '@renderer/lib/ui'
import { useAutoGrowTextarea } from '@renderer/lib/hooks/useAutoGrowTextarea'

export const ComposerTextarea = forwardRef<
  HTMLTextAreaElement,
  {
    value: string
    onChange: (value: string) => void
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
    placeholder?: string
    disabled?: boolean
    className?: string
    onSelect?: TextareaHTMLAttributes<HTMLTextAreaElement>['onSelect']
    onClick?: TextareaHTMLAttributes<HTMLTextAreaElement>['onClick']
    onKeyUp?: TextareaHTMLAttributes<HTMLTextAreaElement>['onKeyUp']
    'aria-expanded'?: boolean
    'aria-controls'?: string
    'aria-autocomplete'?: 'list' | 'none' | 'inline' | 'both'
    'aria-activedescendant'?: string
  }
>(function ComposerTextarea(
  {
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    className,
    onSelect,
    onClick,
    onKeyUp,
    'aria-expanded': ariaExpanded,
    'aria-controls': ariaControls,
    'aria-autocomplete': ariaAutocomplete,
    'aria-activedescendant': ariaActivedescendant
  },
  ref
) {
  useAutoGrowTextarea(ref as RefObject<HTMLTextAreaElement | null>, value)

  return (
    <Textarea
      ref={ref}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onSelect={onSelect}
      onClick={onClick}
      onKeyUp={onKeyUp}
      placeholder={placeholder}
      aria-label="Message"
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-autocomplete={ariaAutocomplete}
      aria-activedescendant={ariaActivedescendant}
      disabled={disabled}
    />
  )
})
