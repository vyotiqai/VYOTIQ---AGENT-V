import { memo } from 'react'
import { cn } from '@renderer/lib/ui'
import { TOOL_CARD_HEADER, TOOL_CARD_SURFACE } from '@renderer/lib/utils/layout'
import type { ChangedFile } from '../utils/transcriptRows'
import { basename } from '../toolUi'
import { FileBadge } from './FileBadge'

export const ChangeSummary = memo(function ChangeSummary({ files }: { files: ChangedFile[] }) {
  if (files.length === 0) return null

  const totalAdded = files.reduce((sum, file) => sum + file.added, 0)
  const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0)

  return (
    <div className={cn(TOOL_CARD_SURFACE, 'w-full')}>
      <div className={cn(TOOL_CARD_HEADER, 'flex items-center border-b border-border text-fg')}>
        <span className="font-medium">
          {files.length} {files.length === 1 ? 'File Changed' : 'Files Changed'}
        </span>
        <span className="ml-auto tabular-nums text-tertiary">
          {totalAdded > 0 ? <span className="text-success">+{totalAdded}</span> : null}
          {totalRemoved > 0 ? <span className="ml-2 text-danger">-{totalRemoved}</span> : null}
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {files.map((file) => (
          <li
            key={file.path}
            className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-xs [&+&]:border-t [&+&]:border-border/60"
          >
            <FileBadge path={file.path} />
            <span className="min-w-0 truncate text-fg" title={file.path}>
              {basename(file.path)}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
              {file.added > 0 ? <span className="text-success">+{file.added}</span> : null}
              {file.removed > 0 ? <span className="text-danger">-{file.removed}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
})
