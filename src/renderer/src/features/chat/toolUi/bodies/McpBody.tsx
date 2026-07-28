import { useMemo } from 'react'
import { cn } from '@renderer/lib/ui'
import { TOOL_BODY_INNER } from '@renderer/lib/utils/layout'
import { isUnresolvedToolName } from '@shared/toolSummary'
import { humanizeSnakeCase } from '@shared/utils/mcpToolMeta'
import type { ToolBodyProps } from '../types'
import { parseMcpData } from '../parsers/mcp'
import { CodeBlock, CopyButton, PathList, TruncatedBanner } from '../primitives'

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function McpResultBody({
  data,
  loading,
  loadFailed,
  truncated
}: {
  data: ReturnType<typeof parseMcpData>
  loading: boolean
  loadFailed: boolean
  truncated: boolean
}) {
  const view = data.resultView
  const banner = truncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null

  if (view.kind === 'paths') {
    return (
      <div>
        {banner}
        <PathList paths={view.paths} />
      </div>
    )
  }
  if (view.kind === 'code') {
    return (
      <div>
        {banner}
        <CodeBlock lines={view.lines} />
      </div>
    )
  }
  if (view.kind === 'lines') {
    return (
      <div>
        {banner}
        <ul className={cn(TOOL_BODY_INNER, 'm-0 max-h-48 list-none overflow-auto p-0')}>
          {view.lines.map((line) => (
            <li key={line} className="truncate py-0.5 font-mono text-[11px] text-fg/80" title={line}>
              {line}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className={TOOL_BODY_INNER}>
      {banner}
      <div className="flex items-start gap-1">
        <pre
          className={cn(
            'm-0 min-w-0 flex-1 max-h-48 overflow-auto rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-fg/80 [overflow-wrap:anywhere]',
            data.isError && 'text-danger'
          )}
        >
          {view.text || '(empty)'}
        </pre>
        {view.text ? <CopyButton text={view.text} className="mt-1 shrink-0" /> : null}
      </div>
    </div>
  )
}

export function McpBody({ tool, loading, loadFailed, mcpServerNames }: ToolBodyProps) {
  const data = useMemo(
    () => parseMcpData(tool, mcpServerNames),
    [tool, mcpServerNames]
  )
  const showServerChip = data.serverName !== data.serverId

  return (
    <div className="flex flex-col gap-2">
      <div className={`${TOOL_BODY_INNER} flex flex-wrap items-center gap-2`}>
        {showServerChip ? (
          <span className="rounded-sm border border-border bg-surface-2/60 px-1.5 py-px text-[10px] text-tertiary">
            {data.serverName}
          </span>
        ) : null}
        <span className="font-medium text-[11px] text-fg">{humanizeSnakeCase(data.toolName)}</span>
      </div>
      {data.args && Object.keys(data.args).length > 0 ? (
        <div className={TOOL_BODY_INNER}>
          <h4 className="m-0 mb-1 text-[10px] font-medium text-tertiary">Arguments</h4>
          <pre className="m-0 max-h-24 overflow-auto rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[10px] text-fg/75">
            {formatJson(data.args)}
          </pre>
        </div>
      ) : null}
      <div>
        <h4 className={cn(TOOL_BODY_INNER, 'm-0 pb-0 text-[10px] font-medium text-tertiary')}>
          Result
        </h4>
        <McpResultBody
          data={data}
          loading={loading}
          loadFailed={loadFailed}
          truncated={tool.contentTruncated === true}
        />
      </div>
    </div>
  )
}

export function FallbackBody({ tool, loading, loadFailed }: ToolBodyProps) {
  const unresolved = isUnresolvedToolName(tool.name)
  return (
    <div>
      {tool.contentTruncated ? <TruncatedBanner loading={loading} failed={loadFailed} /> : null}
      <pre
        className="m-0 max-h-48 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg/80 [overflow-wrap:anywhere]"
        aria-busy={loading || undefined}
      >
        {!unresolved && tool.argsPreview ? `args: ${tool.argsPreview}\n\n` : ''}
        {tool.content ?? ''}
      </pre>
    </div>
  )
}
