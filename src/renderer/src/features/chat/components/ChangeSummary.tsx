import { memo, useState } from 'react'
import { cn } from '@renderer/lib/ui'
import { Button } from '@renderer/lib/ui'
import { TOOL_CARD_HEADER, TOOL_CARD_SURFACE } from '@renderer/lib/utils/layout'
import type { ChangedFile } from '../utils/transcriptRows'
import { basename } from '../toolUi'
import type { DiffLine } from '../toolUi'
import { FileBadge } from './FileBadge'
import { DiffPreview } from './DiffPreview'

export type ChangeSummaryFileResolution = 'kept' | 'discarded' | undefined

export const ChangeSummary = memo(function ChangeSummary({
  files,
  fileDiffs,
  fileResolutions,
  canResolve = false,
  resolveBusy = false,
  onKeepFile,
  onDiscardFile,
  onKeepAll,
  onDiscardAll,
  onDiffExpandChange
}: {
  files: ChangedFile[]
  /** Path → tool-arg diff lines for this turn (optional). */
  fileDiffs?: ReadonlyMap<string, DiffLine[]>
  /** Path → Keep/Discard status from the write checkpoint. */
  fileResolutions?: ReadonlyMap<string, ChangeSummaryFileResolution>
  canResolve?: boolean
  resolveBusy?: boolean
  onKeepFile?: (path: string) => void | Promise<unknown>
  onDiscardFile?: (path: string) => void | Promise<unknown>
  onKeepAll?: () => void | Promise<unknown>
  onDiscardAll?: () => void | Promise<unknown>
  /** Fired when any file diff panel is open (for virtualizer estimates). */
  onDiffExpandChange?: (hasExpanded: boolean) => void
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())

  if (files.length === 0) return null

  const totalAdded = files.reduce((sum, file) => sum + file.added, 0)
  const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0)
  const unresolved = files.filter((f) => !fileResolutions?.get(f.path))

  const togglePath = (path: string): void => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      onDiffExpandChange?.(next.size > 0)
      return next
    })
  }

  return (
    <div className={cn(TOOL_CARD_SURFACE, 'w-full')}>
      <div className={cn(TOOL_CARD_HEADER, 'flex items-center border-b border-border text-fg')}>
        <span className="font-medium">
          {files.length} {files.length === 1 ? 'File Changed' : 'Files Changed'}
        </span>
        <span className="ml-auto flex items-center gap-2 tabular-nums text-tertiary">
          {totalAdded > 0 ? <span className="text-success">+{totalAdded}</span> : null}
          {totalRemoved > 0 ? <span className="ml-2 text-danger">-{totalRemoved}</span> : null}
          {canResolve && unresolved.length > 0 ? (
            <>
              {onKeepAll ? (
                <Button
                  variant="subtle"
                  className="ml-2 h-6 px-2 text-xs"
                  disabled={resolveBusy}
                  onClick={() => {
                    void onKeepAll()
                  }}
                >
                  {resolveBusy ? 'Working…' : 'Keep all'}
                </Button>
              ) : null}
              {onDiscardAll ? (
                <Button
                  variant="subtle"
                  className="h-6 px-2 text-xs"
                  disabled={resolveBusy}
                  onClick={() => {
                    void onDiscardAll()
                  }}
                >
                  {resolveBusy ? 'Working…' : 'Discard all'}
                </Button>
              ) : null}
            </>
          ) : null}
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {files.map((file) => {
          const resolution = fileResolutions?.get(file.path)
          const norm = file.path.replace(/\\/g, '/')
          const lines = fileDiffs?.get(norm) ?? fileDiffs?.get(file.path)
          const expanded = expandedPaths.has(file.path)
          const canExpand = Boolean(lines && lines.length > 0) || file.removed > 0

          return (
            <li
              key={file.path}
              className="min-w-0 [&+&]:border-t [&+&]:border-border/60"
            >
              <div className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-xs">
                {canExpand ? (
                  <button
                    type="button"
                    className="shrink-0 rounded px-0.5 text-tertiary transition-colors hover:bg-surface hover:text-fg"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide diff' : 'Show diff'}
                    onClick={() => togglePath(file.path)}
                  >
                    {expanded ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="w-3 shrink-0" aria-hidden />
                )}
                <FileBadge path={file.path} />
                <span className="min-w-0 truncate text-fg" title={file.path}>
                  {basename(file.path)}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
                  {file.added > 0 ? <span className="text-success">+{file.added}</span> : null}
                  {file.removed > 0 ? <span className="text-danger">-{file.removed}</span> : null}
                  {resolution === 'kept' ? (
                    <span className="text-tertiary">Kept</span>
                  ) : resolution === 'discarded' ? (
                    <span className="text-tertiary">Discarded</span>
                  ) : canResolve ? (
                    <>
                      {onKeepFile ? (
                        <Button
                          variant="subtle"
                          className="h-5 px-1.5 text-[10px]"
                          disabled={resolveBusy}
                          onClick={() => {
                            void onKeepFile(file.path)
                          }}
                        >
                          Keep
                        </Button>
                      ) : null}
                      {onDiscardFile ? (
                        <Button
                          variant="subtle"
                          className="h-5 px-1.5 text-[10px]"
                          disabled={resolveBusy}
                          onClick={() => {
                            void onDiscardFile(file.path)
                          }}
                        >
                          Discard
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </span>
              </div>
              {expanded ? (
                <div className="border-t border-border/40 bg-surface-2/30 px-2 py-1">
                  {lines && lines.length > 0 ? (
                    <DiffPreview lines={lines} path={file.path} expanded />
                  ) : (
                    <p className="m-0 px-1 py-1 text-[11px] text-muted">File deleted</p>
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
})
