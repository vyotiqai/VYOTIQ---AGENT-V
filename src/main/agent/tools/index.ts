import { logger, logErrorSummary } from '../../../shared/logger'
import { formatError, isAbortError, isExpectedToolError } from '../../../shared/errors'
import { summarizeToolArgsFromRecord } from '../../../shared/toolSummary'
import { validateToolArgs, type AgentToolName } from '../schemas/tools'
import { invokeMcpTool, parseMcpToolName, getMcpToolDefinition } from '../mcp'
import { isMcpToolPermitted } from '../../../shared/utils/mcpToolPolicy'
import { validateAgainstJsonSchema } from '../schemas/jsonSchemaValidate'
import { toolRead, READ_CONTENT_CAP } from './read'
import { toolEdit } from './edit'
import { toolSearch, SEARCH_DEFAULT_MAX_RESULTS } from './search'
import { toolGlob } from './glob'
import { toolGrep } from './grep'
import { toolListDir } from './listDir'
import { toolMultiEdit, type MultiEditEntry } from './multiEdit'
import { toolStrReplace } from './strReplace'
import { toolDelete } from './deletePath'
import { toolTodoWrite, type TodoItem } from './todo'
import { toolWebFetch } from './webFetch'
import { toolWebSearch } from './webSearch'
import { isFindstrNoMatchContent, isDirMissingPathContent, toolTerminal, TERMINAL_MAX_TIMEOUT_MS } from './terminal'
import { runSubagent, SubagentDepthError, type SubagentContextUsage } from '../subagent'
import { toolMemoryList, toolMemoryRead, toolMemoryWrite } from './memory'
import { toolGitDiffAsync, toolGitStatusAsync } from './gitHelpers'
import { toolDiagnosticsAsync } from './diagnostics'
import { getSettings } from '@main/settings/settings'
import { getWriteCheckpoint } from '../checkpoints'
import {
  assertToolAllowedInMode,
  isPlanArtifactPath
} from './modePolicy'
import type { AgentInteractionMode } from '../../../shared/ipc'
import { basename } from 'path'

export interface ToolResult {
  ok: boolean
  summary: string
  content: string
  /** True when tools layer already logged this failure (avoid duplicate agent warn). */
  failureLogged?: boolean
}

/** Run-scoped state a handler may need beyond the workspace path. */
export type ToolExecutionContext = {
  /** Directory of the run that issued the call; absent outside a run. */
  runDir?: string
  /** Nesting level of the caller: 0 for the top-level run, 1 inside a sub-agent. */
  depth?: number
  /** Ask / Plan / Agent mode for this invoke. */
  agentMode?: AgentInteractionMode
  /** Skip write-checkpoint priors (Plan run artifacts are not workspace writes). */
  skipWriteCheckpoint?: boolean
  /** Live progress from a long-running tool, surfaced under its transcript row. */
  onProgress?: (update: { kind: 'text' | 'thinking' | 'tool' | 'done'; text: string }) => void
  /** Per-step context fill for nested sub-agents. */
  onSubagentContextUsage?: (usage: SubagentContextUsage) => void
  /**
   * MCP servers enabled for this run (workspace overrides applied).
   * When set, MCP invokes outside this set are rejected even if globally connected.
   */
  runEnabledMcpIds?: ReadonlySet<string>
  /** Per-server allow/deny policy for bare MCP tool names. */
  mcpToolPolicies?: ReadonlyMap<string, { allowedTools?: string[]; deniedTools?: string[] }>
}

type ToolHandler = (
  workspace: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  context: ToolExecutionContext
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
  // Soft-success helpers are cmd-oriented only.
  const shellLine = /^shell:\s*(\S+)/m.exec(content)
  const shell = shellLine?.[1]
  if (shell && shell !== 'cmd') return false
  if (isFindstrNoMatchContent(command, content)) return true
  return isDirMissingPathContent(command, content)
}

const BUILTIN_HANDLERS: Record<AgentToolName, ToolHandler> = {
  read: (workspace, args, signal) => {
    throwIfAborted(signal)
    const path = String(args.path ?? '')
    const offset = typeof args.offset === 'number' ? args.offset : undefined
    const limit = typeof args.limit === 'number' ? args.limit : undefined
    const startLine = typeof args.startLine === 'number' ? args.startLine : undefined
    const endLine = typeof args.endLine === 'number' ? args.endLine : undefined
    const content = toolRead(workspace, path, { offset, limit, startLine, endLine })
    throwIfAborted(signal)
    return toolOk('read', path, content.slice(0, READ_CONTENT_CAP))
  },
  edit: (workspace, args, signal, context) => {
    throwIfAborted(signal)
    const path = String(args.path ?? '')
    if (!context.skipWriteCheckpoint) {
      getWriteCheckpoint(context.runDir)?.recordPrior(path, 'write')
    }
    const contents = typeof args.contents === 'string' ? args.contents : undefined
    const diff = typeof args.diff === 'string' ? args.diff : undefined
    const content = toolEdit(workspace, path, contents, diff)
    throwIfAborted(signal)
    return toolOk('edit', path, content)
  },
  search: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const query = String(args.query ?? '')
    const maxResults =
      typeof args.maxResults === 'number' ? args.maxResults : SEARCH_DEFAULT_MAX_RESULTS
    const regex = args.regex === true
    const content = await toolSearch(workspace, query, maxResults, signal, regex)
    throwIfAborted(signal)
    return toolOk('search', query, content)
  },
  glob: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const pattern = String(args.pattern ?? '')
    const maxResults = typeof args.maxResults === 'number' ? args.maxResults : undefined
    const content = await toolGlob(workspace, pattern, maxResults, signal)
    throwIfAborted(signal)
    return toolOk('glob', pattern, content)
  },
  grep: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const pattern = String(args.pattern ?? '')
    const content = await toolGrep(
      workspace,
      pattern,
      {
        include: typeof args.include === 'string' ? args.include : undefined,
        caseSensitive: args.caseSensitive === true,
        contextLines: typeof args.contextLines === 'number' ? args.contextLines : undefined,
        maxResults: typeof args.maxResults === 'number' ? args.maxResults : undefined
      },
      signal
    )
    throwIfAborted(signal)
    return toolOk('grep', pattern, content)
  },
  list_dir: (workspace, args, signal) => {
    throwIfAborted(signal)
    const path = typeof args.path === 'string' && args.path.trim() ? args.path : '.'
    return toolOk('list_dir', path, toolListDir(workspace, path))
  },
  multi_edit: (workspace, args, signal, context) => {
    throwIfAborted(signal)
    const edits = (Array.isArray(args.edits) ? args.edits : []) as MultiEditEntry[]
    const cp = getWriteCheckpoint(context.runDir)
    if (cp) {
      for (const edit of edits) {
        if (typeof edit.path === 'string' && edit.path.trim()) {
          cp.recordPrior(edit.path, 'write')
        }
      }
    }
    const content = toolMultiEdit(workspace, edits)
    return toolOk('multi_edit', `${edits.length} files`, content)
  },
  str_replace: (workspace, args, signal, context) => {
    throwIfAborted(signal)
    const path = String(args.path ?? '')
    if (!context.skipWriteCheckpoint) {
      getWriteCheckpoint(context.runDir)?.recordPrior(path, 'write')
    }
    const content = toolStrReplace(
      workspace,
      path,
      String(args.old_string ?? ''),
      typeof args.new_string === 'string' ? args.new_string : '',
      args.replace_all === true
    )
    throwIfAborted(signal)
    return toolOk('str_replace', path, content)
  },
  delete: (workspace, args, signal, context) => {
    throwIfAborted(signal)
    const path = String(args.path ?? '')
    const recursive = args.recursive === true
    getWriteCheckpoint(context.runDir)?.recordPrior(path, 'delete', { recursiveDir: recursive })
    const content = toolDelete(workspace, path, recursive)
    return toolOk('delete', path, content)
  },
  todo_write: (_workspace, args, signal, context) => {
    throwIfAborted(signal)
    const todos = (Array.isArray(args.todos) ? args.todos : []) as TodoItem[]
    const { content } = toolTodoWrite(context.runDir ?? '', todos, args.merge === true)
    return toolOk('todo_write', `${todos.length} tasks`, content)
  },
  web_fetch: async (_workspace, args, signal) => {
    throwIfAborted(signal)
    const url = String(args.url ?? '')
    const content = await toolWebFetch(
      url,
      {
        maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined,
        timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined
      },
      signal
    )
    throwIfAborted(signal)
    return toolOk('web_fetch', url, content)
  },
  web_search: async (_workspace, args, signal) => {
    throwIfAborted(signal)
    const query = String(args.query ?? '')
    const content = await toolWebSearch(
      query,
      {
        maxResults: typeof args.maxResults === 'number' ? args.maxResults : undefined,
        timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined
      },
      signal
    )
    throwIfAborted(signal)
    return toolOk('web_search', query, content)
  },
  browser_navigate: async (_workspace, args, signal) => {
    throwIfAborted(signal)
    const url = String(args.url ?? '')
    // Dynamic import keeps Electron out of unit-test graph for tools/index.
    const { navigateUrl } = await import('@main/app/agentBrowser')
    const content = await navigateUrl(url, {
      signal,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined
    })
    throwIfAborted(signal)
    return toolOk('browser_navigate', url, content)
  },
  browser_snapshot: async (_workspace, args, signal, context) => {
    throwIfAborted(signal)
    const { snapshotPage } = await import('@main/app/agentBrowser')
    const content = await snapshotPage({
      signal,
      maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined,
      runDir: context.runDir
    })
    throwIfAborted(signal)
    return toolOk('browser_snapshot', 'page', content)
  },
  browser_click: async (_workspace, args, signal) => {
    throwIfAborted(signal)
    const selector = String(args.selector ?? '')
    const { clickSelector } = await import('@main/app/agentBrowser')
    const button =
      args.button === 'left' || args.button === 'right' || args.button === 'middle'
        ? args.button
        : undefined
    const content = await clickSelector(selector, { signal, button })
    throwIfAborted(signal)
    return toolOk('browser_click', selector, content)
  },
  browser_type: async (_workspace, args, signal) => {
    throwIfAborted(signal)
    const text = String(args.text ?? '')
    const { typeText } = await import('@main/app/agentBrowser')
    const content = await typeText(text, {
      signal,
      selector: typeof args.selector === 'string' ? args.selector : undefined,
      clear: args.clear === true,
      pressEnter: args.pressEnter === true
    })
    throwIfAborted(signal)
    const target =
      typeof args.selector === 'string' && args.selector.trim()
        ? args.selector.trim()
        : 'active element'
    return toolOk('browser_type', target, content)
  },
  subagent: async (workspace, args, signal, context) => {
    throwIfAborted(signal)
    const task = String(args.task ?? '')
    const summary = task.slice(0, 80)
    let outcome: Awaited<ReturnType<typeof runSubagent>>
    try {
      outcome = await runSubagent({
        task,
        context: typeof args.context === 'string' ? args.context : undefined,
        workspace,
        signal,
        depth: context.depth ?? 0,
        emit: context.onProgress,
        onContextUsage: context.onSubagentContextUsage
      })
    } catch (err) {
      if (err instanceof SubagentDepthError) return toolFail('subagent', summary, err.message)
      throw err
    }
    if (!outcome.ok) return toolFail('subagent', summary, outcome.report)
    return toolOk('subagent', summary, outcome.report)
  },
  terminal: async (workspace, args, signal) => {
    const command = String(args.command ?? '')
    const requested =
      typeof args.timeoutMs === 'number' ? args.timeoutMs : 60_000
    const timeoutMs = Math.min(TERMINAL_MAX_TIMEOUT_MS, Math.max(1, requested))
    const shell = getSettings().terminalShell ?? 'auto'
    const content = await toolTerminal(workspace, command, signal, { timeoutMs, shell })
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
    return toolOk('memory_read', path, content.slice(0, READ_CONTENT_CAP))
  },
  memory_write: (workspace, args, signal) => {
    throwIfAborted(signal)
    const path = String(args.path ?? '')
    const contents = typeof args.contents === 'string' ? args.contents : ''
    const content = toolMemoryWrite(workspace, path, contents)
    return toolOk('memory_write', path, content)
  },
  git_status: async (workspace, _args, signal) => {
    throwIfAborted(signal)
    const content = await toolGitStatusAsync(workspace)
    throwIfAborted(signal)
    return toolOk('git_status', 'git status', content)
  },
  git_diff: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const path = typeof args.path === 'string' ? args.path : undefined
    const staged = args.staged === true
    const result = await toolGitDiffAsync(workspace, { path, staged })
    throwIfAborted(signal)
    const summary = path ? `git diff ${path}` : staged ? 'git diff --staged' : 'git diff'
    // Match git_status: non-repo is informative ok content, not a hard tool failure.
    if (!result.ok && result.content === 'Not a git repository') {
      return toolOk('git_diff', summary, result.content)
    }
    if (!result.ok) return toolFail('git_diff', summary, result.content)
    return toolOk('git_diff', summary, result.content)
  },
  diagnostics: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const kind = args.kind === 'lint' ? 'lint' : 'typecheck'
    const result = await toolDiagnosticsAsync(workspace, kind, signal)
    throwIfAborted(signal)
    if (!result.ok) return toolFail('diagnostics', kind, result.content)
    return toolOk('diagnostics', kind, result.content)
  }
}

export const BUILTIN_TOOL_NAMES = Object.keys(BUILTIN_HANDLERS) as AgentToolName[]

export async function executeTool(
  name: string,
  argsJson: string,
  workspace: string,
  signal: AbortSignal,
  context: ToolExecutionContext = {}
): Promise<ToolResult> {
  throwIfAborted(signal)

  const agentMode: AgentInteractionMode = context.agentMode ?? 'agent'

  const mcp = parseMcpToolName(name)
  if (mcp) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(argsJson || '{}') as Record<string, unknown>
    } catch {
      return toolFail(name, name, 'Failed to parse tool arguments JSON')
    }
    const modeGate = assertToolAllowedInMode(agentMode, name, parsed)
    if (!modeGate.ok) {
      return toolFail(name, name, modeGate.error)
    }
    if (context.runEnabledMcpIds && !context.runEnabledMcpIds.has(mcp.serverId)) {
      return toolFail(
        name,
        name,
        `MCP server "${mcp.serverId}" is not enabled for this workspace run`
      )
    }
    const policy = context.mcpToolPolicies?.get(mcp.serverId)
    if (policy && !isMcpToolPermitted(mcp.toolName, policy)) {
      return toolFail(
        name,
        name,
        `MCP tool "${mcp.toolName}" is blocked by this server's allow/deny list`
      )
    }
    const def = getMcpToolDefinition(name)
    if (!def) {
      return toolFail(name, name, `Unknown or unavailable MCP tool: ${name}`)
    }
    const checked = validateAgainstJsonSchema(
      def.parameters as Record<string, unknown> | undefined,
      parsed
    )
    if (!checked.ok) {
      logger.warn('Invalid MCP tool args', {
        scope: 'tools',
        code: 'TOOL_ARGS',
        tool: name
      })
      return toolFail(name, 'invalid args', checked.error)
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
  const modeGate = assertToolAllowedInMode(agentMode, name, args)
  if (!modeGate.ok) {
    return toolFail(name, summarizeToolArgsFromRecord(name, args), modeGate.error)
  }
  const summary = summarizeToolArgsFromRecord(name, args)
  if (!Object.prototype.hasOwnProperty.call(BUILTIN_HANDLERS, name)) {
    return toolFail(name, name, `Unknown tool: ${name}`)
  }
  const handler = BUILTIN_HANDLERS[name as AgentToolName]

  // Plan mode: read/write plan.md / contract.md in the run directory, not the workspace.
  let effectiveWorkspace = workspace
  let effectiveArgs = args
  let effectiveContext = context
  if (
    agentMode === 'plan' &&
    (name === 'edit' || name === 'str_replace' || name === 'read') &&
    typeof args.path === 'string' &&
    isPlanArtifactPath(args.path)
  ) {
    if (!context.runDir) {
      return toolFail(name, summary, 'Plan artifacts require an active run directory')
    }
    effectiveWorkspace = context.runDir
    effectiveArgs = { ...args, path: basename(args.path.replace(/\\/g, '/')) }
    if (name === 'edit' || name === 'str_replace') {
      effectiveContext = { ...context, skipWriteCheckpoint: true }
    }
  }

  try {
    return await handler(effectiveWorkspace, effectiveArgs, signal, effectiveContext)
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
