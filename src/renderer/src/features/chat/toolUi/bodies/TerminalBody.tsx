import { useMemo } from 'react'
import { cn } from '@renderer/lib/ui'
import type { ToolBodyProps } from '../types'
import { parseTerminalCardData } from '../parsers/terminal'
import { TruncatedBanner } from '../primitives'

export function TerminalBody({ tool, loading, loadFailed }: ToolBodyProps) {
  const data = useMemo(() => parseTerminalCardData(tool), [tool])

  return (
    <div aria-busy={loading || undefined}>
      {data.cwd ? (
        <p className="m-0 border-b border-border px-3 py-1 font-mono text-[10px] text-tertiary">
          {data.cwd}
        </p>
      ) : null}
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      <pre
        className={cn(
          'm-0 overflow-x-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg/75 [overflow-wrap:anywhere]'
        )}
      >
        {data.output}
        {data.stderr ? (
          <span className="text-danger">
            {data.output ? '\n' : ''}
            {data.stderr}
          </span>
        ) : null}
      </pre>
    </div>
  )
}
