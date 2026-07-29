import type { UiSubagentContextUsage, UiSubagentEntry, UiToolRow } from '@shared/transcript'
import { toolHasBody } from '../toolUi'
import { ToolBodyView } from '../toolUi'

/** Output pane for an expanded compact tool. The caller owns the surrounding indent. */
export function ToolRowOutput({
  tool,
  subagent,
  subagentContextUsage,
  onLoadFullContent,
  mcpServerNames,
  inGroup
}: {
  tool: UiToolRow
  subagent?: UiSubagentEntry[]
  subagentContextUsage?: UiSubagentContextUsage
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
  mcpServerNames?: ReadonlyMap<string, string>
  inGroup?: boolean
}) {
  const hasDetails = toolHasBody(tool, { subagent, subagentContextUsage })
  if (!hasDetails) return null

  return (
    <div className="flex flex-col gap-1 pb-1.5 pl-2">
      <ToolBodyView
        context={{
          tool,
          expanded: true,
          subagent,
          subagentContextUsage,
          onLoadFullContent,
          mcpServerNames,
          inGroup
        }}
      />
    </div>
  )
}
