import { useFullToolContent } from '../components/useFullToolContent'
import type { ToolBodyContext } from './types'
import { getToolBody } from './registry'

export function ToolBodyView({
  context
}: {
  context: ToolBodyContext
}) {
  const { tool, expanded, onLoadFullContent, subagent, subagentContextUsage, mcpServerNames, inGroup } =
    context
  const skipLazyLoad = tool.name === 'subagent'
  const enabled = !skipLazyLoad && expanded && tool.contentTruncated === true
  const { loading, failed } = useFullToolContent(tool, enabled, onLoadFullContent)
  const Body = getToolBody(tool.name)

  return (
    <Body
      tool={tool}
      expanded={expanded}
      subagent={subagent}
      subagentContextUsage={subagentContextUsage}
      onLoadFullContent={onLoadFullContent}
      loading={loading}
      loadFailed={failed}
      mcpServerNames={mcpServerNames}
      inGroup={inGroup}
    />
  )
}
