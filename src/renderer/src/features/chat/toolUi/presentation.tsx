import { createElement } from 'react'
import { useFullToolContent } from '../components/useFullToolContent'
import type { ToolBodyContext } from './types'
import { getToolBody } from './registry'
import { wrapFamilyShell } from './shells'

export function ToolBodyView({
  context
}: {
  context: ToolBodyContext
}) {
  const { tool, expanded, onLoadFullContent, subagent, subagentContextUsage, mcpServerNames, inGroup } =
    context
  // Load full content whenever truncated — collapsed previews still need the full text.
  const enabled = tool.contentTruncated === true
  const { loading, failed } = useFullToolContent(tool, enabled, onLoadFullContent)
  const body = createElement(getToolBody(tool.name), {
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
  return wrapFamilyShell(tool.name, body)
}
