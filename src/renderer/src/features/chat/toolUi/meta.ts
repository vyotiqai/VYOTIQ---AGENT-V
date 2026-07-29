import type { UiToolRow } from '@shared/transcript'
import {
  MCP_TOOL_PREFIX,
  TOOL_LABELS,
  isUnresolvedToolName,
  parseArgsRecord,
  parseMcpToolDisplay
} from '@shared/toolSummary'
import { mcpDoneLabel, mcpRunningLabel, mcpToolKind, humanizeSnakeCase } from '@shared/utils/mcpToolMeta'
import { isReadOnlyTerminalCommand } from '@shared/utils/displayPath'
import type { IconName } from '@renderer/lib/icons'
import type { ToolCategory, ToolPresentation } from './types'

const PROMINENT_TOOLS = new Set([
  'terminal',
  'edit',
  'multi_edit',
  'str_replace',
  'todo_write',
  'delete'
])

const FILE_TOOLS = new Set(['read', 'memory_read'])
const EDIT_TOOLS = new Set([
  'edit',
  'multi_edit',
  'str_replace',
  'memory_write',
  'delete',
  'todo_write'
])
const SEARCH_TOOLS = new Set(['search', 'grep', 'glob', 'web_fetch', 'git_status', 'git_diff'])
const BROWSE_TOOLS = new Set(['list_dir', 'memory_list'])
const COMMAND_TOOLS = new Set(['terminal', 'subagent', 'diagnostics'])

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
  if (isUnresolvedToolName(name)) {
    return status === 'running' ? 'Preparing…' : 'Tool'
  }
  const mcp = parseMcpToolDisplay(name)
  if (mcp) {
    return status === 'running' ? mcpRunningLabel(mcp.toolName) : mcpDoneLabel(mcp.toolName)
  }
  const labels = TOOL_LABELS[name]
  if (!labels) {
    const human = humanizeSnakeCase(name)
    return status === 'running' ? `Running ${human}` : human
  }
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

const TOOL_ICON_BY_NAME: Record<string, IconName> = {
  read: 'file',
  edit: 'edit',
  multi_edit: 'edit',
  str_replace: 'edit',
  search: 'fileSearch',
  grep: 'scanSearch',
  glob: 'folderSearch',
  list_dir: 'folderOpen',
  delete: 'trash',
  todo_write: 'listTodo',
  web_fetch: 'globe',
  subagent: 'bot',
  terminal: 'terminal',
  memory_list: 'memory',
  memory_read: 'memory',
  memory_write: 'memory',
  git_status: 'branch',
  git_diff: 'branch',
  diagnostics: 'scanSearch'
}

export function toolIconName(name: string): IconName {
  if (isMcpTool(name)) return 'plug'
  return TOOL_ICON_BY_NAME[name] ?? 'file'
}

export { FILE_TOOLS, EDIT_TOOLS, SEARCH_TOOLS, BROWSE_TOOLS, COMMAND_TOOLS }
