import { useMemo } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { TOOL_BODY_INNER } from '@renderer/lib/utils/layout'
import type { ToolBodyProps } from '../types'
import { parseTodoData } from '../parsers/todo'
import type { TodoStatus } from '../parsers/todo'

const STATUS_ICON: Record<TodoStatus, { name: 'check' | 'refresh' | 'close' | 'doc' | 'search'; className: string }> = {
  pending: { name: 'search', className: 'text-tertiary' },
  in_progress: { name: 'refresh', className: 'text-accent' },
  completed: { name: 'check', className: 'text-success' },
  cancelled: { name: 'close', className: 'text-tertiary' }
}

export function TodoBody({ tool }: ToolBodyProps) {
  const data = useMemo(() => parseTodoData(tool), [tool])

  return (
    <ul className={cn(TOOL_BODY_INNER, 'm-0 list-none p-0')}>
      {data.items.map((item, index) => {
        const icon = STATUS_ICON[item.status]
        return (
          <li key={index} className="flex items-start gap-2 py-0.5 text-[11px] leading-relaxed">
            <Icon name={icon.name} size={11} className={cn('mt-0.5 shrink-0', icon.className)} />
            <span
              className={cn(
                'min-w-0 whitespace-pre-wrap text-fg/80 [overflow-wrap:anywhere]',
                item.status === 'completed' && 'text-tertiary line-through',
                item.status === 'cancelled' && 'text-tertiary'
              )}
            >
              {item.content}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
