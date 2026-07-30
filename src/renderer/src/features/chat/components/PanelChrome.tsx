import { Icon } from '@renderer/lib/icons'

export function PanelHeader({
  title,
  onClose
}: {
  title: string
  onClose?: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg">{title}</span>
      {onClose ? (
        <button
          type="button"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-fg"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()} panel`}
        >
          Close
        </button>
      ) : null}
    </div>
  )
}

export function EmptyPanel({
  icon,
  title,
  body
}: {
  icon: 'terminal' | 'file' | 'branch' | 'pullRequest'
  title: string
  body: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <Icon name={icon} size={28} className="mb-3 text-muted/50" />
      <p className="text-[12px] font-medium text-fg/80">{title}</p>
      <p className="mt-1 max-w-[16rem] text-[11px] leading-relaxed text-muted">{body}</p>
    </div>
  )
}
