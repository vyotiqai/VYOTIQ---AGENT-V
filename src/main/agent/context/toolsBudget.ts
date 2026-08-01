import type { ToolDefinition } from '../providers/types'
import { AGENT_TOOLS } from '../types'
import { MCP_TOOL_PREFIX } from '../mcp'
import { estimateTextTokens } from './estimate'
import { logger } from '../../../shared/logger'

const BUILTIN_NAMES = new Set(AGENT_TOOLS.map((t) => t.name))

/**
 * Built-ins that may be shed (largest-first) so pinned/unpinned MCP can fit.
 * Core file/edit/search/MCP meta/memory tools stay required.
 */
const OPTIONAL_BUILTIN_NAMES = new Set(
  AGENT_TOOLS.map((t) => t.name).filter(
    (name) =>
      name.startsWith('browser_') ||
      name === 'web_search' ||
      name === 'diagnostics' ||
      name === 'subagent' ||
      name === 'generate_image' ||
      name === 'edit_image'
  )
)

function estimateToolDefTokens(tool: ToolDefinition): number {
  try {
    return estimateTextTokens(JSON.stringify(tool))
  } catch {
    return 200
  }
}

/**
 * Fit tool definitions into the tools token budget.
 * Required builtins stay; optional builtins may shed for MCP; pinned MCP preferred.
 */
export function trimToolsToBudget(
  tools: ToolDefinition[],
  budgetTokens: number,
  options?: { pinnedMcpNames?: ReadonlySet<string> }
): {
  tools: ToolDefinition[]
  estimate: number
  omittedMcp: number
  omittedMcpNames: string[]
} {
  const builtins = tools.filter((t) => BUILTIN_NAMES.has(t.name))
  const mcp = tools.filter((t) => t.name.startsWith(MCP_TOOL_PREFIX))
  const pinnedNames = options?.pinnedMcpNames

  const required = builtins.filter((t) => !OPTIONAL_BUILTIN_NAMES.has(t.name))
  const optional = builtins.filter((t) => OPTIONAL_BUILTIN_NAMES.has(t.name))

  let kept = [...required]
  let estimate = kept.reduce((n, t) => n + estimateToolDefTokens(t), 0)

  const pinned: ToolDefinition[] = []
  const unpinned: ToolDefinition[] = []
  for (const tool of mcp) {
    if (pinnedNames?.has(tool.name)) pinned.push(tool)
    else unpinned.push(tool)
  }

  const tryKeep = (tool: ToolDefinition): boolean => {
    const toolEst = estimateToolDefTokens(tool)
    if (estimate + toolEst <= budgetTokens) {
      kept.push(tool)
      estimate += toolEst
      return true
    }
    const overhead = estimateToolDefTokens({ ...tool, description: '' })
    const availableTokens = Math.max(0, budgetTokens - estimate - overhead)
    const truncated = truncateToolDescription(tool, Math.max(80, availableTokens))
    const truncEst = estimateToolDefTokens(truncated)
    if (estimate + truncEst <= budgetTokens) {
      kept.push(truncated)
      estimate += truncEst
      return true
    }
    return false
  }

  // Optional builtins first (may later be shed for MCP).
  for (const tool of optional) {
    tryKeep(tool)
  }

  // Pinned MCP first (agent-requested), then greedy smallest-first fill.
  for (const tool of pinned) {
    if (tryKeep(tool)) continue
    if (shedOptionalBuiltinsFor(tool)) tryKeep(tool)
  }

  const sortedUnpinned = [...unpinned].sort(
    (a, b) => estimateToolDefTokens(a) - estimateToolDefTokens(b)
  )
  for (const tool of sortedUnpinned) {
    if (tryKeep(tool)) continue
    if (shedOptionalBuiltinsFor(tool)) tryKeep(tool)
  }

  function shedOptionalBuiltinsFor(incoming: ToolDefinition): boolean {
    const need = estimateToolDefTokens(incoming)
    if (estimate + need <= budgetTokens) return true
    const optionalKept = kept
      .filter((t) => OPTIONAL_BUILTIN_NAMES.has(t.name))
      .sort((a, b) => estimateToolDefTokens(b) - estimateToolDefTokens(a))
    for (const drop of optionalKept) {
      const dropEst = estimateToolDefTokens(drop)
      kept = kept.filter((t) => t.name !== drop.name)
      estimate = Math.max(0, estimate - dropEst)
      if (estimate + need <= budgetTokens) return true
    }
    return estimate + need <= budgetTokens
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
      estimate,
      omittedPreview: omittedMcpNames.slice(0, 10).join(', ')
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
