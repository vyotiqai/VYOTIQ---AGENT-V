import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../icons'
import { cn } from './cn'

export const SearchInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & {
    onClear?: () => void
    clearLabel?: string
    inputClassName?: string
    trailing?: ReactNode
  }
>(function SearchInput(
  {
    className = '',
    inputClassName = '',
    value,
    onClear,
    clearLabel = 'Clear search',
    trailing,
    ...props
  },
  ref
) {
  const showClear = Boolean(onClear && value)

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 focus-within:border-border-strong focus-within:outline focus-within:outline-1 focus-within:outline-offset-0 focus-within:outline-focus',
        className
      )}
    >
      <Icon name="search" size={13} className="shrink-0 text-muted" />
      <input
        ref={ref}
        className={cn(
          'min-h-8 w-full border-none bg-transparent text-sm tracking-[var(--vy-tracking)] text-fg outline-none placeholder:text-muted',
          inputClassName
        )}
        value={value}
        {...props}
      />
      {showClear ? (
        <button
          type="button"
          className="inline-grid size-6 shrink-0 place-items-center rounded-sm text-muted vy-transition hover:bg-surface-2 hover:text-fg active:bg-surface"
          aria-label={clearLabel}
          onClick={onClear}
        >
          <Icon name="close" size={12} />
        </button>
      ) : null}
      {trailing}
    </div>
  )
})
