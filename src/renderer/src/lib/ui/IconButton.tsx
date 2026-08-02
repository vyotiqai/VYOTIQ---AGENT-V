import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from '../icons'
import { cn } from './cn'

const interactive =
  'vy-transition disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)]'

const iconButtonVariants = {
  ghost: 'text-fg hover:bg-surface active:bg-surface-2',
  /** No fill at rest or hover — icon-only chrome (sidebar toggle). */
  bare: 'text-fg hover:text-fg-strong active:opacity-80',
  primary: 'bg-accent text-accent-fg hover:bg-fg-strong active:opacity-90',
  subtle:
    'border border-border bg-surface text-fg hover:bg-surface-2 hover:border-border-strong active:bg-surface-2'
} as const

const iconButtonSizes = {
  xs: 'size-6',
  sm: 'size-7',
  md: 'size-8',
  lg: 'size-9'
} as const

const iconSizes: Record<keyof typeof iconButtonSizes, number> = {
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: IconName
    label: string
    variant?: keyof typeof iconButtonVariants
    size?: keyof typeof iconButtonSizes
  }
>(function IconButton(
  {
    icon,
    label,
    variant = 'ghost',
    size = 'md',
    className = '',
    type = 'button',
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-grid place-items-center rounded-md',
        interactive,
        iconButtonSizes[size],
        iconButtonVariants[variant],
        className
      )}
      type={type}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={iconSizes[size]} />
    </button>
  )
})
