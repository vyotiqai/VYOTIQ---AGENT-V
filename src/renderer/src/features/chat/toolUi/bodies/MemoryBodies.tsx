import { useMemo } from 'react'
import { TOOL_BODY_INNER } from '@renderer/lib/utils/layout'
import type { ToolBodyProps } from '../types'
import {
  parseMemoryListData,
  parseMemoryReadData,
  parseMemoryWriteData
} from '../parsers/memory'
import { CodeBlock, TruncatedBanner } from '../primitives'

export function MemoryListBody({ tool, loading, loadFailed }: ToolBodyProps) {
  const data = useMemo(() => parseMemoryListData(tool), [tool])

  return (
    <div className={`${TOOL_BODY_INNER} space-y-2 text-[11px]`} aria-busy={loading || undefined}>
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      <section>
        <h4 className="m-0 mb-1 text-[10px] font-medium uppercase tracking-wide text-tertiary">
          index.md
        </h4>
        <p className="m-0 whitespace-pre-wrap text-fg/80">{data.indexExcerpt || '(empty)'}</p>
      </section>
      <section>
        <h4 className="m-0 mb-1 text-[10px] font-medium uppercase tracking-wide text-tertiary">
          notes/
        </h4>
        {data.notes.length ? (
          <ul className="m-0 list-disc pl-4 text-fg/80">
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-tertiary">(none)</p>
        )}
      </section>
      <p className="m-0 text-tertiary">state.md: {data.hasState ? 'present' : 'absent'}</p>
    </div>
  )
}

export function MemoryReadBody({ tool, loading, loadFailed, inGroup }: ToolBodyProps) {
  const data = useMemo(() => parseMemoryReadData(tool), [tool])

  return (
    <div>
      {!inGroup ? (
        <div className="border-b border-border px-3 py-1 font-mono text-[10px] text-tertiary">
          {data.path}
        </div>
      ) : null}
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      <CodeBlock lines={data.lines} />
    </div>
  )
}

export function MemoryWriteBody({ tool, inGroup }: ToolBodyProps) {
  const data = useMemo(() => parseMemoryWriteData(tool), [tool])

  return (
    <div>
      {!inGroup ? (
        <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-1">
          <span className="truncate font-mono text-[10px] text-tertiary">{data.path}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-tertiary">
            {data.charCount} chars
          </span>
        </div>
      ) : null}
      <CodeBlock lines={data.preview.split('\n')} />
    </div>
  )
}
