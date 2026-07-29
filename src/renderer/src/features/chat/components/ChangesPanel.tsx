import { useMemo } from 'react'
import { cn } from '@renderer/lib/ui/cn'
import type { UiItem } from '@shared/transcript'
import type { DiffLine } from '../toolUi'
import { parseDiffPreview, parseEditCardData } from '../toolUi'
import { ChangeSummary } from './ChangeSummary'
import { collectChangedFiles } from './FilesPanel'
import { EmptyPanel, PanelHeader } from './TerminalPanel'
import type { ToolItem } from '../utils/transcriptRows'

function isToolItem(item: UiItem): item is ToolItem {
  return item.kind === 'tool'
}

function collectFileDiffs(items: UiItem[]): Map<string, DiffLine[]> {
  const out = new Map<string, DiffLine[]>()
  for (const item of items) {
    if (!isToolItem(item) || item.tool.status !== 'done') continue
    if (
      item.tool.name !== 'edit' &&
      item.tool.name !== 'multi_edit' &&
      item.tool.name !== 'str_replace'
    ) {
      continue
    }
    if (item.tool.name === 'multi_edit') {
      // multi_edit diffs are best-effort via parseDiffPreview on the whole tool.
      const lines = parseDiffPreview(item.tool)
      const { path } = parseEditCardData(item.tool)
      if (path && lines.length) {
        const key = path.replace(/\\/g, '/')
        const existing = out.get(key) ?? []
        out.set(key, [...existing, ...lines])
      }
      continue
    }
    const { path } = parseEditCardData(item.tool)
    const lines = parseDiffPreview(item.tool)
    if (!path || lines.length === 0) continue
    const key = path.replace(/\\/g, '/')
    const existing = out.get(key) ?? []
    out.set(key, [...existing, ...lines])
  }
  return out
}

/**
 * Docked panel showing a ChangeSummary for the latest agent write rollup.
 */
export function ChangesPanel({
  items,
  className,
  onClose,
  writeFileResolutions,
  canResolve,
  resolveBusy,
  onKeepWriteFile,
  onDiscardWriteFile,
  onKeepAllWrites,
  onDiscardAllWrites
}: {
  items: UiItem[]
  className?: string
  onClose?: () => void
  writeFileResolutions?: ReadonlyMap<string, 'kept' | 'discarded' | undefined>
  canResolve?: boolean
  resolveBusy?: boolean
  onKeepWriteFile?: (path: string) => void | Promise<unknown>
  onDiscardWriteFile?: (path: string) => void | Promise<unknown>
  onKeepAllWrites?: () => void | Promise<unknown>
  onDiscardAllWrites?: () => void | Promise<unknown>
}) {
  const files = useMemo(() => collectChangedFiles(items), [items])
  const fileDiffs = useMemo(() => collectFileDiffs(items), [items])

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-[min(42vw,480px)] shrink-0 flex-col overflow-hidden border-l border-border/50 bg-bg',
        className
      )}
      data-changes-panel
      aria-label="Changes panel"
    >
      <PanelHeader title="Changes" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {files.length === 0 ? (
          <EmptyPanel
            icon="branch"
            title="No changes yet"
            body="Agent edits will appear here with Keep / Discard when available."
          />
        ) : (
          <ChangeSummary
            files={files}
            fileDiffs={fileDiffs}
            fileResolutions={writeFileResolutions}
            canResolve={canResolve}
            resolveBusy={resolveBusy}
            onKeepFile={onKeepWriteFile}
            onDiscardFile={onDiscardWriteFile}
            onKeepAll={onKeepAllWrites}
            onDiscardAll={onDiscardAllWrites}
          />
        )}
      </div>
    </aside>
  )
}
