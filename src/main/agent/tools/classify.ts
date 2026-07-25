import { MCP_TOOL_PREFIX } from '../mcp'

const READ_ONLY_BUILTIN = new Set(['read', 'search', 'memory_list', 'memory_read'])

/** Built-in tools safe to run in parallel (read-only, no workspace mutation). */
export function isReadOnlyTool(name: string): boolean {
  if (READ_ONLY_BUILTIN.has(name)) return true
  if (!name.startsWith(MCP_TOOL_PREFIX)) return false
  const lower = name.toLowerCase()
  if (/(write|delete|remove|create|update|patch|edit|mutate|execute|run|shell|terminal)/.test(lower)) {
    return false
  }
  return true
}

export const MAX_PARALLEL_READ_TOOLS = 4
