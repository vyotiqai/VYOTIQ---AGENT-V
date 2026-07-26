import type { UiToolRow } from '@shared/transcript'
import { MCP_TOOL_PREFIX, TOOL_LABELS, parseArgsRecord, parseMcpToolDisplay } from '@shared/toolSummary'
import { mcpDoneLabel, mcpRunningLabel, mcpToolKind } from '@shared/utils/mcpToolMeta'
import { isReadOnlyTerminalCommand } from '@shared/utils/displayPath'
import type { ToolCategory, ToolPresentation } from './types'

const PROMINENT_TOOLS = new Set([
  'terminal',
  'edit',
  'multi_edit',
  'todo_write',
  'subagent',
  'delete'
])

const FILE_TOOLS = new Set(['read', 'memory_read'])
const EDIT_TOOLS = new Set(['edit', 'multi_edit', 'memory_write', 'delete', 'todo_write'])
const SEARCH_TOOLS = new Set(['search', 'grep', 'glob', 'web_fetch'])
const BROWSE_TOOLS = new Set(['list_dir', 'memory_list'])
const COMMAND_TOOLS = new Set(['terminal', 'subagent'])

const CATEGORY_LABELS: Record<ToolCategory, { running: string; done: string }> = {
  file: { running: 'Reading', done: 'Read' },
  edit: { running: 'Editing', done: 'Edited' },
  search: { running: 'Searching', done: 'Searched' },
  command: { running: 'Running', done: 'Ran' },
  browse: { running: 'Listing', done: 'Listed' }
}

const MIXED_LABELS = { running: 'Exploring', done: 'Explored' }

export function isProminentTool(name: string, argsPreview?: string): boolean {
  if (!PROMINENT_TOOLS.has(name)) return false
  if (name === 'terminal' && argsPreview) {
    const args = parseArgsRecord(argsPreview)
    const command = args?.command ?? args?.cmd
    if (typeof command === 'string' && isReadOnlyTerminalCommand(command)) return false
  }
  return true
}

export function toolPresentation(name: string, argsPreview?: string): ToolPresentation {
  return isProminentTool(name, argsPreview) ? 'prominent' : 'compact'
}

export function mcpToolCategory(toolName: string): ToolCategory {
  const kind = mcpToolKind(toolName)
  switch (kind) {
    case 'file':
      return 'file'
    case 'browse':
      return 'browse'
    case 'command':
      return 'command'
    case 'search':
      return 'search'
    case 'other':
      return 'search'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

export function toolCategory(name: string): ToolCategory {
  if (FILE_TOOLS.has(name)) return 'file'
  if (EDIT_TOOLS.has(name)) return 'edit'
  if (SEARCH_TOOLS.has(name)) return 'search'
  if (BROWSE_TOOLS.has(name)) return 'browse'
  if (COMMAND_TOOLS.has(name)) return 'command'
  const mcp = parseMcpToolDisplay(name)
  if (mcp) return mcpToolCategory(mcp.toolName)
  return 'file'
}

export function toolLabel(name: string, status: UiToolRow['status']): string {
  const mcp = parseMcpToolDisplay(name)
  if (mcp) {
    return status === 'running' ? mcpRunningLabel(mcp.toolName) : mcpDoneLabel(mcp.toolName)
  }
  const labels = TOOL_LABELS[name]
  if (!labels) return status === 'running' ? 'Running' : 'Done'
  return status === 'running' ? labels.running : labels.done
}

export function categoryLabels(category: ToolCategory): { running: string; done: string } {
  return CATEGORY_LABELS[category]
}

export function mixedGroupLabels(): { running: string; done: string } {
  return MIXED_LABELS
}

export function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX)
}

export { FILE_TOOLS, EDIT_TOOLS, SEARCH_TOOLS, BROWSE_TOOLS, COMMAND_TOOLS }
