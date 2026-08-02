import { createElement } from 'react'
import { useFullToolContent } from '../components/useFullToolContent'
import type { ToolBodyContext } from './types'
import { getToolBody } from './registry'
import { isProminentPresentation } from './meta'
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
  // Full content loads only while the body is visible (ExpandPanel open or card expanded).
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
  // Bordered ToolCard already provides chrome for prominent tools.
  if (isProminentPresentation(tool)) return body
  return wrapFamilyShell(tool.name, body)
}
