import { createElement } from 'react'
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
  // Load full content whenever truncated — collapsed cards still show a clamped
  // preview, so waiting for expand left the preview stuck on the truncated stub.
  const enabled = tool.contentTruncated === true
  const { loading, failed } = useFullToolContent(tool, enabled, onLoadFullContent)
  return createElement(getToolBody(tool.name), {
    tool,
    expanded,
    subagent,
    subagentContextUsage,
    onLoadFullContent,
    loading,
    loadFailed: failed,
    mcpServerNames,
    inGroup
  })
}
