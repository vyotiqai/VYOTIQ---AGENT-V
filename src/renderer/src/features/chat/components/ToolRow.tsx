import type { UiToolRow } from '@shared/transcript'
import { ToolBodyView } from '../toolUi'

/** Output pane for an expanded compact tool. The caller owns the surrounding indent. */
export function ToolRowOutput({
  tool,
  onLoadFullContent,
  mcpServerNames,
  inGroup
}: {
  tool: UiToolRow
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
  mcpServerNames?: ReadonlyMap<string, string>
  inGroup?: boolean
}) {
  const hasDetails = Boolean(tool.content || tool.argsPreview)
  if (!hasDetails) return null

  return (
    <div className="flex flex-col gap-1 pb-1.5 pl-2">
      <ToolBodyView
        context={{
          tool,
          expanded: true,
          onLoadFullContent,
          mcpServerNames,
          inGroup
        }}
      />
    </div>
  )
}
