import { type ReactNode } from 'react'
import { Icon, type IconName } from '../icons'
import { cn } from './cn'

export function NavItem({
  label,
  icon,
  active,
  onClick,
  current,
  pressed,
  className = ''
}: {
  label: string
  icon?: IconName
  active?: boolean
  onClick: () => void
  current?: boolean
  pressed?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'app-region-no-drag flex w-full items-center gap-2 rounded-md px-2.5 py-[6px] text-left text-sm tracking-[var(--vy-tracking-tight)] vy-transition',
        active ? 'bg-surface-2 text-fg-strong' : 'text-muted hover:bg-surface hover:text-fg active:bg-surface-2',
        className
      )}
      aria-current={current ? 'page' : undefined}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} size={15} /> : null}
      <span className="truncate">{label}</span>
    </button>
  )
}

export function SettingsNavItem({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'shrink-0 rounded-md px-2.5 py-[6px] text-left text-sm tracking-[var(--vy-tracking-tight)] vy-transition sm:w-full',
        active ? 'bg-surface-2 text-fg-strong' : 'text-muted hover:bg-surface hover:text-fg'
      )}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
