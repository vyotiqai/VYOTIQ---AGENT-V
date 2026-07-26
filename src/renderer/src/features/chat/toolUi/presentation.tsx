import { useFullToolContent } from '../components/useFullToolContent'
import type { ToolBodyContext } from './types'
import { getToolBody } from './registry'

export function ToolBodyView({
  context
}: {
  context: ToolBodyContext
}) {
  const { tool, expanded, onLoadFullContent, subagent, mcpServerNames, inGroup } = context
  const enabled = expanded || tool.contentTruncated === true
  const { loading, failed } = useFullToolContent(tool, enabled, onLoadFullContent)
  const Body = getToolBody(tool.name)

  return (
    <Body
      tool={tool}
      expanded={expanded}
      subagent={subagent}
      onLoadFullContent={onLoadFullContent}
      loading={loading}
      loadFailed={failed}
      mcpServerNames={mcpServerNames}
      inGroup={inGroup}
    />
  )
}
