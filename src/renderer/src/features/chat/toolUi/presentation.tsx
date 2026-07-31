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
  const {
    tool,
    expanded,
    onLoadFullContent,
    subagent,
    subagentContextUsage,
    nestedAgent,
    onRespondApproval,
    mcpServerNames,
    inGroup
  } = context
  // Fetch full content only while the body is expanded (mounted in ExpandPanel).
  const enabled = tool.contentTruncated === true && expanded === true
  const { loading, failed } = useFullToolContent(tool, enabled, onLoadFullContent)
  const body = createElement(getToolBody(tool.name), {
    tool,
    expanded,
    subagent,
    subagentContextUsage,
    nestedAgent,
    onRespondApproval,
    onLoadFullContent,
    loading,
    loadFailed: failed,
    mcpServerNames,
    inGroup
  })
  return wrapFamilyShell(tool.name, body)
}
