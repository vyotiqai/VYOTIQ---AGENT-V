import { memo, useMemo, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { TOOL_CARD_BODY, TOOL_CARD_HEADER, TOOL_CARD_SURFACE } from '@renderer/lib/utils/layout'
import type { ToolItem } from '../utils/transcriptRows'
import {
  basename,
  parseDiffPreview,
  parseEditCardData,
  parseTerminalCardData,
  toolCardVerb
} from '../utils/toolCardData'
import { DiffPreview } from './DiffPreview'
import { FileBadge } from './FileBadge'
import { useFullToolContent } from './useFullToolContent'

/** Height a collapsed body settles at before it starts crowding the transcript. */
const COLLAPSED_BODY_PX = 168

function CardBody({
  clamped,
  children
}: {
  clamped: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(TOOL_CARD_BODY, clamped && 'mask-fade-bottom')}
      style={clamped ? { maxHeight: COLLAPSED_BODY_PX } : undefined}
    >
      {children}
    </div>
  )
}

export const ToolCard = memo(function ToolCard({
  item,
  expanded,
  onToggle,
  onLoadFullContent
}: {
  item: ToolItem
  expanded?: boolean
  onToggle?: (next: boolean) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
}) {
  const [localOpen, setLocalOpen] = useState(false)
  const isOpen = expanded ?? localOpen
  const { tool } = item
  const isTerminal = tool.name === 'terminal'
  // The task list is the result itself, so it renders as text rather than a diff.
  const isChecklist = tool.name === 'todo_write'
  const isSubagent = tool.name === 'subagent'
  const failed = tool.status === 'fail'
  const running = tool.status === 'running'

  const plain = isTerminal || isChecklist || isSubagent
  const terminalData = useMemo(
    () => (isTerminal ? parseTerminalCardData(tool) : null),
    [isTerminal, tool]
  )
  const editData = useMemo(() => (plain ? null : parseEditCardData(tool)), [plain, tool])
  const diffLines = useMemo(() => (plain ? [] : parseDiffPreview(tool)), [plain, tool])

  const toggle = (): void => {
    const next = !isOpen
    if (onToggle) onToggle(next)
    else setLocalOpen(next)
  }

  const verb = toolCardVerb(tool.name, tool.status)
  const target =
    isTerminal
      ? terminalData?.command || tool.summary
      : isChecklist || isSubagent
        ? tool.summary
        : basename(editData?.path ?? tool.summary)

  const terminalBody = [terminalData?.output, terminalData?.stderr].filter(Boolean).join('\n')
  const checklistBody = isChecklist ? (tool.content ?? '').trim() : ''
  const subagentSteps = isSubagent ? (item.subagent ?? []) : []
  const subagentReport = isSubagent ? (tool.content ?? '').trim() : ''
  const hasBody = isTerminal
    ? Boolean(terminalBody)
    : isChecklist
      ? Boolean(checklistBody)
      : isSubagent
        ? Boolean(subagentReport) || subagentSteps.length > 0
        : diffLines.length > 0

  // The collapsed body only shows a preview, so the rest is worth fetching
  // exactly when the reader opens the card. Edit and write cards truncate the
  // same way terminal output does, so they need the fetch too.
  const { loading, failed: loadFailed } = useFullToolContent(tool, isOpen, onLoadFullContent)

  return (
    <div className={cn(TOOL_CARD_SURFACE, 'w-full')}>
      <button
        type="button"
        className={cn(
          TOOL_CARD_HEADER,
          'flex w-full items-center gap-2 text-left vy-transition',
          hasBody && 'hover:bg-surface/60'
        )}
        onClick={toggle}
        aria-expanded={isOpen}
        disabled={!hasBody}
      >
        {plain || !editData ? (
          <Icon
            name={isTerminal ? 'terminal' : isSubagent ? 'search' : 'edit'}
            size={12}
            className={cn('shrink-0', failed ? 'text-danger' : 'text-tertiary')}
          />
        ) : (
          <FileBadge path={editData.path} />
        )}
        <span className={cn('shrink-0 font-medium', failed ? 'text-danger' : 'text-fg')}>
          {verb}
        </span>
        <span
          className={cn('min-w-0 truncate text-tertiary', isTerminal && 'font-mono')}
          title={target}
        >
          {target}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
          {editData && editData.added > 0 ? (
            <span className="text-success">+{editData.added}</span>
          ) : null}
          {editData && editData.removed > 0 ? (
            <span className="text-danger">-{editData.removed}</span>
          ) : null}
          {hasBody ? (
            <Icon
              name="chevronRight"
              size={12}
              className={cn('text-tertiary vy-transition', isOpen && 'rotate-90')}
            />
          ) : null}
        </span>
      </button>

      {hasBody && isTerminal ? (
        <CardBody clamped={!isOpen}>
          <pre
            className="m-0 overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg/75 [overflow-wrap:anywhere]"
            aria-busy={loading || undefined}
          >
            {terminalData?.output}
            {terminalData?.stderr ? (
              <span className="text-danger">
                {terminalData.output ? '\n' : ''}
                {terminalData.stderr}
              </span>
            ) : null}
          </pre>
        </CardBody>
      ) : null}

      {hasBody && isChecklist ? (
        <CardBody clamped={!isOpen}>
          <ul className="m-0 list-none px-3 py-2 text-[11px] leading-relaxed text-fg/80">
            {checklistBody.split('\n').map((line, index) => (
              <li key={index} className="font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">
                {line}
              </li>
            ))}
          </ul>
        </CardBody>
      ) : null}

      {hasBody && isSubagent ? (
        <CardBody clamped={!isOpen}>
          <div className="flex flex-col gap-1 px-3 py-2 text-[11px] leading-relaxed">
            {subagentSteps.length ? (
              <ul className="m-0 list-none p-0 text-tertiary">
                {subagentSteps.map((entry, index) => (
                  <li key={index} className="min-w-0 truncate" title={entry.text}>
                    {entry.kind === 'tool' ? '↳ ' : ''}
                    {entry.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {subagentReport ? (
              <p className="m-0 whitespace-pre-wrap text-fg/80 [overflow-wrap:anywhere]">
                {subagentReport}
              </p>
            ) : null}
          </div>
        </CardBody>
      ) : null}

      {hasBody && !plain ? (
        <CardBody clamped={false}>
          <div aria-busy={loading || undefined}>
            {tool.contentTruncated && loadFailed ? (
              <p className="m-0 px-3 py-2 text-[10px] text-tertiary">Could not load full output.</p>
            ) : null}
            <DiffPreview
              lines={diffLines}
              path={editData?.path ?? tool.summary ?? ''}
              expanded={isOpen}
            />
          </div>
        </CardBody>
      ) : null}

      {!hasBody && running ? (
        <div className="border-t border-border bg-surface px-3 py-2 text-[11px] text-tertiary">
          Working…
        </div>
      ) : null}
    </div>
  )
})
