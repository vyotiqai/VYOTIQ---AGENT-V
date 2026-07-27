import type { ComponentType } from 'react'
import type { UiToolRow } from '@shared/transcript'
import { summarizeToolArgs } from '@shared/toolSummary'
import { formatPathLabel } from '@shared/utils/displayPath'
import { basename } from '@shared/utils/path'
import { DeleteBody } from './bodies/DeleteBody'
import { EditBody, MultiEditBody } from './bodies/EditBody'
import { GlobBody } from './bodies/GlobBody'
import { GrepBody } from './bodies/GrepBody'
import { ListDirBody } from './bodies/ListDirBody'
import { FallbackBody, McpBody } from './bodies/McpBody'
import { MemoryListBody, MemoryReadBody, MemoryWriteBody } from './bodies/MemoryBodies'
import { ReadBody } from './bodies/ReadBody'
import { SearchBody } from './bodies/SearchBody'
import { SubagentBody } from './bodies/SubagentBody'
import { TerminalBody } from './bodies/TerminalBody'
import { TodoBody } from './bodies/TodoBody'
import { WebFetchBody } from './bodies/WebFetchBody'
import { isMcpTool, toolLabel } from './meta'
import { parseDeleteData } from './parsers/delete'
import { parseDiffPreview, parseEditCardData } from './parsers/edit'
import { parseReadData } from './parsers/read'
import { parseTodoData } from './parsers/todo'
import { parseTerminalCardData } from './parsers/terminal'
import type { ToolBodyProps, ToolHeaderMeta } from './types'

export type ToolRegistryEntry = {
  Body: ComponentType<ToolBodyProps>
  hasBody: (
    tool: UiToolRow,
    ctx?: {
      subagent?: ToolBodyProps['subagent']
      subagentContextUsage?: ToolBodyProps['subagentContextUsage']
    }
  ) => boolean
  headerMeta?: (
    tool: UiToolRow,
    ctx?: {
      subagent?: ToolBodyProps['subagent']
      subagentContextUsage?: ToolBodyProps['subagentContextUsage']
    }
  ) => ToolHeaderMeta
}

function editHasBody(tool: UiToolRow): boolean {
  return parseDiffPreview(tool).length > 0
}

function terminalHasBody(tool: UiToolRow): boolean {
  const data = parseTerminalCardData(tool)
  return Boolean(data.output || data.stderr)
}

function todoHasBody(tool: UiToolRow): boolean {
  return parseTodoData(tool).items.length > 0
}

function subagentHasBody(
  tool: UiToolRow,
  ctx?: {
    subagent?: ToolBodyProps['subagent']
    subagentContextUsage?: ToolBodyProps['subagentContextUsage']
  }
): boolean {
  return (
    Boolean((tool.content ?? '').trim()) ||
    (ctx?.subagent?.length ?? 0) > 0 ||
    Boolean(ctx?.subagentContextUsage)
  )
}

function deleteHasBody(tool: UiToolRow): boolean {
  const data = parseDeleteData(tool)
  return Boolean(data.message || data.path)
}

function defaultHasBody(tool: UiToolRow): boolean {
  return Boolean(tool.content || tool.argsPreview)
}

const BUILTIN_REGISTRY: Record<string, ToolRegistryEntry> = {
  read: {
    Body: ReadBody,
    hasBody: defaultHasBody,
    headerMeta: (tool) => {
      const data = parseReadData(tool)
      const name = basename(data.path) || data.path
      const target = data.lineRange ? `${name} ${data.lineRange}` : name
      return {
        verb: toolLabel(tool.name, tool.status),
        target,
        filePath: data.path
      }
    }
  },
  edit: {
    Body: EditBody,
    hasBody: editHasBody,
    headerMeta: (tool) => {
      const edit = parseEditCardData(tool)
      return {
        verb: toolLabel(tool.name, tool.status),
        target: basename(edit.path),
        added: edit.added,
        removed: edit.removed,
        filePath: edit.path
      }
    }
  },
  multi_edit: {
    Body: MultiEditBody,
    hasBody: editHasBody,
    headerMeta: (tool) => {
      const edit = parseEditCardData(tool)
      return {
        verb: toolLabel(tool.name, tool.status),
        target: edit.path,
        added: edit.added,
        removed: edit.removed,
        filePath: edit.path
      }
    }
  },
  search: { Body: SearchBody, hasBody: defaultHasBody },
  glob: { Body: GlobBody, hasBody: defaultHasBody },
  grep: { Body: GrepBody, hasBody: defaultHasBody },
  list_dir: { Body: ListDirBody, hasBody: defaultHasBody },
  delete: {
    Body: DeleteBody,
    hasBody: deleteHasBody,
    headerMeta: (tool) => {
      const data = parseDeleteData(tool)
      return {
        verb: toolLabel(tool.name, tool.status),
        target: basename(data.path),
        icon: 'trash'
      }
    }
  },
  todo_write: {
    Body: TodoBody,
    hasBody: todoHasBody,
    headerMeta: (tool) => {
      const data = parseTodoData(tool)
      return {
        verb: toolLabel(tool.name, tool.status),
        target: data.total > 0 ? `${data.done}/${data.total} complete` : tool.summary,
        icon: 'check'
      }
    }
  },
  web_fetch: { Body: WebFetchBody, hasBody: defaultHasBody },
  subagent: {
    Body: SubagentBody,
    hasBody: subagentHasBody,
    headerMeta: (tool) => ({
      verb: toolLabel(tool.name, tool.status),
      target: tool.summary,
      icon: 'search'
    })
  },
  terminal: {
    Body: TerminalBody,
    hasBody: terminalHasBody,
    headerMeta: (tool) => {
      const data = parseTerminalCardData(tool)
      const target = data.command ? formatPathLabel(data.command, 72) : tool.summary
      return {
        verb: toolLabel(tool.name, tool.status),
        target,
        icon: 'terminal',
        exitCode: data.exitCode
      }
    }
  },
  memory_list: { Body: MemoryListBody, hasBody: defaultHasBody },
  memory_read: { Body: MemoryReadBody, hasBody: defaultHasBody },
  memory_write: { Body: MemoryWriteBody, hasBody: defaultHasBody }
}

const MCP_ENTRY: ToolRegistryEntry = {
  Body: McpBody,
  hasBody: defaultHasBody
}

const FALLBACK_ENTRY: ToolRegistryEntry = {
  Body: FallbackBody,
  hasBody: defaultHasBody
}

export function getToolEntry(name: string): ToolRegistryEntry {
  if (isMcpTool(name)) return MCP_ENTRY
  return BUILTIN_REGISTRY[name] ?? FALLBACK_ENTRY
}

export function getToolBody(name: string): ComponentType<ToolBodyProps> {
  return getToolEntry(name).Body
}

export function toolHasBody(
  tool: UiToolRow,
  ctx?: {
    subagent?: ToolBodyProps['subagent']
    subagentContextUsage?: ToolBodyProps['subagentContextUsage']
  }
): boolean {
  if (tool.status === 'running') return true
  return getToolEntry(tool.name).hasBody(tool, ctx)
}

export function getToolHeaderMeta(
  tool: UiToolRow,
  ctx?: {
    subagent?: ToolBodyProps['subagent']
    subagentContextUsage?: ToolBodyProps['subagentContextUsage']
  }
): ToolHeaderMeta {
  const entry = getToolEntry(tool.name)
  if (entry.headerMeta) return entry.headerMeta(tool, ctx)
  return {
    verb: toolLabel(tool.name, tool.status),
    target: tool.summary || summarizeToolArgs(tool.name, tool.argsPreview)
  }
}
