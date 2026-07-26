import { memo, useMemo, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { FileBadge } from './FileBadge'
import { TextShimmer } from './TextShimmer'
import type { ToolItem } from '../utils/transcriptRows'
import {
  ProminentChrome,
  ToolBodyView,
  getToolHeaderMeta,
  toolHasBody
} from '../toolUi'

export const ToolCard = memo(function ToolCard({
  item,
  expanded,
  onToggle,
  onLoadFullContent,
  mcpServerNames
}: {
  item: ToolItem
  expanded?: boolean
  onToggle?: (next: boolean) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
  mcpServerNames?: ReadonlyMap<string, string>
}) {
  const { tool } = item
  const [localOpen, setLocalOpen] = useState(tool.name === 'todo_write')
  const isOpen = expanded ?? localOpen
  const failed = tool.status === 'fail'
  const running = tool.status === 'running'

  const headerMeta = useMemo(
    () => getToolHeaderMeta(tool, { subagent: item.subagent }),
    [tool, item.subagent]
  )
  const hasBody = useMemo(
    () => toolHasBody(tool, { subagent: item.subagent }),
    [tool, item.subagent]
  )

  const toggle = (): void => {
    const next = !isOpen
    if (onToggle) onToggle(next)
    else setLocalOpen(next)
  }

  const header = (
    <>
      {headerMeta.filePath ? (
        <FileBadge path={headerMeta.filePath} />
      ) : (
        <Icon
          name={
            headerMeta.icon === 'terminal'
              ? 'terminal'
              : headerMeta.icon === 'search'
                ? 'search'
                : headerMeta.icon === 'check'
                  ? 'check'
                  : headerMeta.icon === 'trash'
                    ? 'warning'
                    : 'edit'
          }
          size={12}
          className={cn('shrink-0', failed ? 'text-danger' : 'text-tertiary')}
        />
      )}
      {running ? (
        <TextShimmer className="shrink-0 font-medium text-fg">{headerMeta.verb}</TextShimmer>
      ) : (
        <span className={cn('shrink-0 font-medium', failed ? 'text-danger' : 'text-fg')}>
          {headerMeta.verb}
        </span>
      )}
      <span
        className={cn(
          'min-w-0 truncate text-tertiary',
          headerMeta.icon === 'terminal' && 'font-mono'
        )}
        title={headerMeta.target}
      >
        {headerMeta.target}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
        {headerMeta.exitCode != null ? (
          <span
            className={cn(
              'rounded-sm px-1 text-[10px]',
              headerMeta.exitCode === 0 ? 'text-success' : 'text-danger'
            )}
            title={`Exit code ${headerMeta.exitCode}`}
          >
            {headerMeta.exitCode === 0 ? 'exit 0' : `failed (${headerMeta.exitCode})`}
          </span>
        ) : null}
        {headerMeta.added != null && headerMeta.added > 0 ? (
          <span className="text-success">+{headerMeta.added}</span>
        ) : null}
        {headerMeta.removed != null && headerMeta.removed > 0 ? (
          <span className="text-danger">-{headerMeta.removed}</span>
        ) : null}
      </span>
    </>
  )

  return (
    <ProminentChrome
      header={header}
      clampWhenCollapsed={tool.name !== 'todo_write'}
      body={
        <ToolBodyView
          context={{
            tool,
            expanded: isOpen,
            subagent: item.subagent,
            onLoadFullContent,
            mcpServerNames
          }}
        />
      }
      expanded={isOpen}
      hasBody={hasBody}
      running={running}
      onToggle={toggle}
    />
  )
})
