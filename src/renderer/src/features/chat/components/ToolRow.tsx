import type {
  UiNestedAgentState,
  UiSubagentContextUsage,
  UiSubagentEntry,
  UiToolRow
} from '@shared/transcript'
import type { ToolApprovalDecision } from '@shared/ipc'
import { cn } from '@renderer/lib/ui'
import { toolHasBody } from '../toolUi'
import { ToolBodyView } from '../toolUi'

/** Output pane for an expanded compact tool. The caller owns the surrounding indent. */
export function ToolRowOutput({
  tool,
  subagent,
  subagentContextUsage,
  nestedAgent,
  onRespondApproval,
  onLoadFullContent,
  mcpServerNames,
  inGroup,
  indent = true
}: {
  tool: UiToolRow
  subagent?: UiSubagentEntry[]
  subagentContextUsage?: UiSubagentContextUsage
  nestedAgent?: UiNestedAgentState
  onRespondApproval?: (requestId: string, decision: ToolApprovalDecision) => void
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
  mcpServerNames?: ReadonlyMap<string, string>
  /** Suppress redundant path chrome already shown in the compact row. */
  inGroup?: boolean
  /** Extra left pad; false when the parent group already indented. */
  indent?: boolean
}) {
  const hasDetails = toolHasBody(tool, { subagent, subagentContextUsage, nestedAgent })
  if (!hasDetails) return null

  return (
    <div className={cn('flex flex-col gap-1 pb-1.5', indent && 'pl-2')}>
      <ToolBodyView
        context={{
          tool,
          expanded: true,
          subagent,
          subagentContextUsage,
          nestedAgent,
          onRespondApproval,
          onLoadFullContent,
          mcpServerNames,
          inGroup
        }}
      />
    </div>
  )
}
