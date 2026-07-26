import { useMemo } from 'react'
import type { ToolBodyProps } from '../types'
import { parseReadData } from '../parsers/read'
import { CodeBlock, DirListing, TruncatedBanner } from '../primitives'

export function ReadBody({ tool, loading, loadFailed }: ToolBodyProps) {
  const data = useMemo(() => parseReadData(tool), [tool])

  return (
    <div>
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      {data.isDirectory ? (
        <DirListing
          entries={data.lines.map((line) => {
            const dir = line.match(/^\[dir\]\s+(.+)$/)
            if (dir) return { kind: 'dir' as const, name: dir[1]!, size: '' }
            const file = line.match(/^\[file\]\s+(.+)$/)
            return { kind: 'file' as const, name: file?.[1] ?? line, size: '' }
          })}
        />
      ) : (
        <CodeBlock lines={data.lines} />
      )}
    </div>
  )
}
