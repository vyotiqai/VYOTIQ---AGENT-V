import { useMemo } from 'react'
import { cn } from '@renderer/lib/ui'
import type { UiItem } from '@shared/transcript'
import { ChangeSummary } from './ChangeSummary'
import { EmptyPanel, PanelHeader } from './PanelChrome'
import {
  collectSessionChangedFiles,
  collectSessionFileDiffs
} from '../utils/turnFileDiffs'

/**
 * Docked panel for session write rollup: file list + Keep / Discard when available.
 */
export function ChangesPanel({
  items,
  className,
  onClose,
  writeFileResolutions,
  resolvablePaths,
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
  /** Active checkpoint paths — Keep/Discard only for these. */
  resolvablePaths?: ReadonlySet<string>
  canResolve?: boolean
  resolveBusy?: boolean
  onKeepWriteFile?: (path: string) => void | Promise<unknown>
  onDiscardWriteFile?: (path: string) => void | Promise<unknown>
  onKeepAllWrites?: () => void | Promise<unknown>
  onDiscardAllWrites?: () => void | Promise<unknown>
}) {
  const files = useMemo(() => collectSessionChangedFiles(items), [items])
  const fileDiffs = useMemo(() => collectSessionFileDiffs(items), [items])

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
            resolvablePaths={resolvablePaths}
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
