import type { UiToolRow } from '@shared/transcript'
import { TOOL_RESULT_IPC_PREVIEW_CHARS } from '@shared/utils/toolResultIpc'
import { useFullToolContent } from './useFullToolContent'

const ARGS_PREVIEW_MAX = TOOL_RESULT_IPC_PREVIEW_CHARS

function truncateArgs(text: string, max = ARGS_PREVIEW_MAX): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…`
}

/** Output pane for an expanded tool. The caller owns the surrounding indent. */
export function ToolRowOutput({
  tool,
  onLoadFullContent
}: {
  tool: UiToolRow
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
}) {
  const { loading, failed } = useFullToolContent(tool, true, onLoadFullContent)
  const hasDetails = Boolean(tool.content || tool.argsPreview)

  if (!hasDetails) return null

  return (
    <div className="flex flex-col gap-1 pb-1.5" aria-busy={loading || undefined}>
      {tool.contentTruncated ? (
        <p className="m-0 text-[10px] text-tertiary">
          {loading
            ? 'Loading full output…'
            : failed
              ? 'Could not load full output.'
              : 'Showing preview — full output loads on expand.'}
        </p>
      ) : null}
      <pre className="m-0 max-h-48 overflow-auto rounded-sm border border-border bg-surface px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg/80 [overflow-wrap:anywhere]">
        {tool.argsPreview ? `args: ${truncateArgs(tool.argsPreview)}\n\n` : ''}
        {tool.content ?? ''}
      </pre>
    </div>
  )
}
