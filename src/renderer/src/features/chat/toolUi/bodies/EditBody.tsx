import { useMemo } from 'react'
import { cn } from '@renderer/lib/ui'
import { DiffPreview } from '../../components/DiffPreview'
import type { ToolBodyProps } from '../types'
import { parseDiffPreview, parseEditCardData } from '../parsers/edit'
import { TruncatedBanner } from '../primitives'

export function EditBody({ tool, expanded, loading, loadFailed }: ToolBodyProps) {
  const editData = useMemo(() => parseEditCardData(tool), [tool])
  const diffLines = useMemo(() => parseDiffPreview(tool), [tool])

  return (
    <div aria-busy={loading || undefined}>
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      {tool.contentTruncated && loadFailed ? (
        <p className="m-0 px-3 py-2 text-[10px] text-tertiary">Could not load full output.</p>
      ) : (
        <DiffPreview lines={diffLines} path={editData.path} expanded={expanded} />
      )}
    </div>
  )
}

export function MultiEditBody(props: ToolBodyProps) {
  return <EditBody {...props} />
}
