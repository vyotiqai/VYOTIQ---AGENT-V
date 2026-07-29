import { useMemo } from 'react'
import { cn } from '@renderer/lib/ui/cn'
import { Icon } from '@renderer/lib/icons'
import type { UiItem } from '@shared/transcript'
import { basename, collectWritingChanges, parseDeleteData } from '../toolUi'
import { FileBadge } from './FileBadge'
import { EmptyPanel, PanelHeader } from './TerminalPanel'
import type { ChangedFile, ToolItem } from '../utils/transcriptRows'

function isToolItem(item: UiItem): item is ToolItem {
  return item.kind === 'tool'
}

function collectChangedFiles(items: UiItem[]): ChangedFile[] {
  const totals = new Map<string, ChangedFile>()
  for (const item of items) {
    if (!isToolItem(item) || item.tool.status !== 'done') continue
    if (item.tool.name === 'delete') {
      const { path } = parseDeleteData(item.tool)
      if (!path) continue
      const existing = totals.get(path)
      if (existing) existing.removed += 1
      else totals.set(path, { path, added: 0, removed: 1 })
      continue
    }
    if (
      item.tool.name !== 'edit' &&
      item.tool.name !== 'multi_edit' &&
      item.tool.name !== 'str_replace'
    ) {
      continue
    }
    for (const change of collectWritingChanges(item.tool)) {
      const existing = totals.get(change.path)
      if (existing) {
        existing.added += change.added
        existing.removed += change.removed
      } else {
        totals.set(change.path, { ...change })
      }
    }
  }
  return [...totals.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Docked panel listing files touched by agent writes in the current transcript.
 */
export function FilesPanel({
  items,
  className,
  onClose
}: {
  items: UiItem[]
  className?: string
  onClose?: () => void
}) {
  const files = useMemo(() => collectChangedFiles(items), [items])

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-[min(42vw,480px)] shrink-0 flex-col overflow-hidden border-l border-border/50 bg-bg',
        className
      )}
      data-files-panel
      aria-label="Files panel"
    >
      <PanelHeader title="Files" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-auto">
        {files.length === 0 ? (
          <EmptyPanel
            icon="file"
            title="No files changed"
            body="Files the agent edits in this chat will show up here."
          />
        ) : (
          <ul className="m-0 list-none p-0">
            {files.map((file) => (
              <li
                key={file.path}
                className="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-2 text-[12px]"
              >
                <FileBadge path={file.path} />
                <span className="min-w-0 flex-1 truncate text-fg" title={file.path}>
                  {basename(file.path)}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
                  {file.added > 0 ? <span className="text-success">+{file.added}</span> : null}
                  {file.removed > 0 ? <span className="text-danger">-{file.removed}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {files.length > 0 ? (
        <div className="flex items-center gap-2 border-t border-border/40 px-3 py-1.5 text-[11px] text-muted">
          <Icon name="file" size={12} />
          <span>
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        </div>
      ) : null}
    </aside>
  )
}

export { collectChangedFiles }
