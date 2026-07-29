import { useMemo } from 'react'
import { TOOL_BODY_PAD } from '@renderer/lib/utils/layout'
import { formatListDirPathLabel } from '@shared/utils/displayPath'
import type { ToolBodyProps } from '../types'
import { parseListDirData } from '../parsers/listDir'
import { DirListing, TruncatedBanner } from '../primitives'

export function ListDirBody({ tool, loading, loadFailed, inGroup }: ToolBodyProps) {
  const data = useMemo(() => parseListDirData(tool), [tool])
  const showPathHeader = !inGroup
  const pathLabel = formatListDirPathLabel(data.path)

  return (
    <div>
      {showPathHeader ? (
        <div className={`${TOOL_BODY_PAD} pb-1`}>
          <span className="font-mono text-[10px] text-tertiary">
            {pathLabel}
            {data.totalEntries > 0
              ? ` — ${data.totalEntries} ${data.totalEntries === 1 ? 'item' : 'items'}`
              : ''}
            {data.truncated ? ' (truncated)' : ''}
          </span>
        </div>
      ) : data.truncated ? (
        <div className={`${TOOL_BODY_PAD} pb-1`}>
          <span className="font-mono text-[10px] text-tertiary">Listing truncated</span>
        </div>
      ) : null}
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      <DirListing entries={data.entries} />
    </div>
  )
}
