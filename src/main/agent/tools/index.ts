import { logger, logErrorSummary } from '../../../shared/logger'
import { formatError, isAbortError, isExpectedToolError } from '../../../shared/errors'
import { summarizeToolArgsFromRecord } from '../../../shared/toolSummary'
import { validateToolArgs } from '../schemas/tools'
import { invokeMcpTool, parseMcpToolName } from '../mcp'
import { toolRead } from './read'
import { toolEdit } from './edit'
import { toolSearch } from './search'
import { isFindstrNoMatchContent, isDirMissingPathContent, toolTerminal } from './terminal'
import { toolMemoryList, toolMemoryRead, toolMemoryWrite } from './memory'

export interface ToolResult {
  ok: boolean
  summary: string
  content: string
  /** True when tools layer already logged this failure (avoid duplicate agent warn). */
  failureLogged?: boolean
}

type ToolHandler = (
  workspace: string,
  args: Record<string, unknown>,
  signal: AbortSignal
) => Promise<ToolResult> | ToolResult

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

function logToolSuccess(name: string): void {
  logger.info('Tool succeeded', {
    scope: 'tools',
    tool: name
  })
}

function toolOk(name: string, summary: string, content: string): ToolResult {
  logToolSuccess(name)
  return { ok: true, summary, content }
}

function toolFail(
  name: string,
  summary: string,
  content: string,
  opts?: { failureLogged?: boolean }
): ToolResult {
  return { ok: false, summary, content, failureLogged: opts?.failureLogged }
}

function logToolFailure(name: string, err: unknown): void {
  const fields = {
    scope: 'tools' as const,
    code: 'TOOL_EXEC' as const,
    tool: name,
    err
  }
  const summary = logErrorSummary(err, 'TOOL_EXEC')
  if (isExpectedToolError(formatError(err))) {
    logger.warn(`Tool execution failed: ${summary}`, fields)
  } else {
    logger.error(`Tool execution failed: ${summary}`, fields)
  }
}

export function terminalResultOk(command: string, content: string): boolean {
  if (!content.includes('exit_code: ')) return true
  if (/exit_code: 0\b/.test(content)) return true
  if (isFindstrNoMatchContent(command, content)) return true
  return isDirMissingPathContent(command, content)
}

const BUILTIN_HANDLERS: Record<string, ToolHandler> = {
  read: (workspace, args, signal) => {
    throwIfAborted(signal)
    const path = String(args.path ?? '')
    const offset = typeof args.offset === 'number' ? args.offset : undefined
    const limit = typeof args.limit === 'number' ? args.limit : undefined
    const content = toolRead(workspace, path, { offset, limit })
    throwIfAborted(signal)
    return toolOk('read', path, content.slice(0, 100_000))
  },
  edit: (workspace, args, signal) => {
    throwIfAborted(signal)
    const path = String(args.path ?? '')
    const contents = typeof args.contents === 'string' ? args.contents : undefined
    const diff = typeof args.diff === 'string' ? args.diff : undefined
    const content = toolEdit(workspace, path, contents, diff)
    throwIfAborted(signal)
    return toolOk('edit', path, content)
  },
  search: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const query = String(args.query ?? '')
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : 40
    const regex = args.regex === true
    const content = await toolSearch(workspace, query, maxResults, signal, regex)
    throwIfAborted(signal)
    return toolOk('search', query, content)
  },
  terminal: async (workspace, args, signal) => {
    const command = String(args.command ?? '')
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 60_000
    const content = await toolTerminal(workspace, command, signal, timeoutMs)
    const summary = command.slice(0, 80)
    const ok = terminalResultOk(command, content)
    if (ok) return toolOk('terminal', summary, content)
    return toolFail('terminal', summary, content)
  },
  memory_list: (workspace, _args, signal) => {
    throwIfAborted(signal)
    return toolOk('memory_list', 'memory', toolMemoryList(workspace))
  },
  memory_read: (workspace, args, signal) => {
    throwIfAborted(signal)
    const path = String(args.path ?? '')
    const content = toolMemoryRead(workspace, path)
    return toolOk('memory_read', path, content.slice(0, 100_000))
  },
  memory_write: (workspace, args, signal) => {
    throwIfAborted(signal)
    const path = String(args.path ?? '')
    const contents = typeof args.contents === 'string' ? args.contents : ''
    const content = toolMemoryWrite(workspace, path, contents)
    return toolOk('memory_write', path, content)
  }
}

export async function executeTool(
  name: string,
  argsJson: string,
  workspace: string,
  signal: AbortSignal
): Promise<ToolResult> {
  throwIfAborted(signal)

  const mcp = parseMcpToolName(name)
  if (mcp) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(argsJson || '{}') as Record<string, unknown>
    } catch {
      return toolFail(name, name, 'Failed to parse tool arguments JSON')
    }
    return invokeMcpTool(mcp.serverId, mcp.toolName, parsed, signal, name)
  }

  const validated = validateToolArgs(name, argsJson)
  if (!validated.ok) {
    logger.warn('Invalid tool args', {
      scope: 'tools',
      code: 'TOOL_ARGS',
      tool: name
    })
    return toolFail(name, 'invalid args', validated.error)
  }
  const args = validated.data
  const summary = summarizeToolArgsFromRecord(name, args)
  const handler = BUILTIN_HANDLERS[name]
  if (!handler) {
    return toolFail(name, name, `Unknown tool: ${name}`)
  }

  try {
    return await handler(workspace, args, signal)
  } catch (err) {
    if (isAbortError(err)) {
      logger.warn('Tool aborted', { scope: 'tools', tool: name })
      throw err
    }
    const message = formatError(err)
    logToolFailure(name, err)
    return toolFail(name, summary, message, { failureLogged: true })
  }
}
