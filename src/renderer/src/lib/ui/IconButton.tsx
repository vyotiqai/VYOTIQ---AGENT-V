import { type ButtonHTMLAttributes } from 'react'
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
  xs: 'size-5',
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-8'
} as const

const iconSizes: Record<keyof typeof iconButtonSizes, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 16
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName
  label: string
  variant?: keyof typeof iconButtonVariants
  size?: keyof typeof iconButtonSizes
}) {
  return (
    <button
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
}
