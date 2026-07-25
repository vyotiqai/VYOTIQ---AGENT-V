import { forwardRef, type KeyboardEvent, type RefObject } from 'react'
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
  }
>(function ComposerTextarea(
  { value, onChange, onKeyDown, placeholder, disabled, className },
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
      placeholder={placeholder}
      aria-label="Message"
      disabled={disabled}
    />
  )
})
