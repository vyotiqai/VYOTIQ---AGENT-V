import type { ToolDefinition } from '../providers/types'
import { AGENT_TOOLS } from '../types'
import { MCP_TOOL_PREFIX } from '../mcp'
import { estimateTextTokens } from './estimate'
import { logger } from '../../../shared/logger'

const BUILTIN_NAMES = new Set(AGENT_TOOLS.map((t) => t.name))

function estimateToolDefTokens(tool: ToolDefinition): number {
  try {
    return estimateTextTokens(JSON.stringify(tool))
  } catch {
    return 200
  }
}

/**
 * Fit tool definitions into the tools token budget.
 * Built-in tools are always kept; MCP tools may be truncated or dropped.
 */
export function trimToolsToBudget(
  tools: ToolDefinition[],
  budgetTokens: number
): {
  tools: ToolDefinition[]
  estimate: number
  omittedMcp: number
  omittedMcpNames: string[]
} {
  const builtins = tools.filter((t) => BUILTIN_NAMES.has(t.name))
  const mcp = tools.filter((t) => t.name.startsWith(MCP_TOOL_PREFIX))

  let kept = [...builtins]
  let estimate = kept.reduce((n, t) => n + estimateToolDefTokens(t), 0)

  // Fit MCP tools by estimated size (smallest first) so more defs survive the budget.
  const sortedMcp = [...mcp].sort(
    (a, b) => estimateToolDefTokens(a) - estimateToolDefTokens(b)
  )

  for (const tool of sortedMcp) {
    const toolEst = estimateToolDefTokens(tool)
    if (estimate + toolEst <= budgetTokens) {
      kept.push(tool)
      estimate += toolEst
      continue
    }
    const truncated = truncateToolDescription(tool, Math.max(80, budgetTokens - estimate))
    const truncEst = estimateToolDefTokens(truncated)
    if (estimate + truncEst <= budgetTokens) {
      kept.push(truncated)
      estimate += truncEst
    }
  }

  const keptMcpNames = new Set(
    kept.filter((t) => t.name.startsWith(MCP_TOOL_PREFIX)).map((t) => t.name)
  )
  const omittedMcpNames = mcp.map((t) => t.name).filter((n) => !keptMcpNames.has(n))
  const omittedMcp = omittedMcpNames.length
  if (omittedMcp > 0) {
    logger.warn('MCP tools omitted to fit tools budget', {
      scope: 'agent',
      code: 'CONTEXT_TOOLS_BUDGET',
      omittedMcp,
      budgetTokens,
      estimate
    })
  }

  return { tools: kept, estimate, omittedMcp, omittedMcpNames }
}

function truncateToolDescription(
  tool: ToolDefinition,
  maxDescChars: number
): ToolDefinition {
  const desc = tool.description ?? ''
  if (desc.length <= maxDescChars) return tool
  return {
    ...tool,
    description: desc.slice(0, maxDescChars) + '…'
  }
}
