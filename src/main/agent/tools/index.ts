import { logger, logErrorSummary } from '../../../shared/logger'
import { formatError, isAbortError, isExpectedToolError } from '../../../shared/errors'
import { summarizeToolArgsFromRecord } from '../../../shared/toolSummary'
import { validateToolArgs, type AgentToolName } from '../schemas/tools'
import { invokeMcpTool, parseMcpToolName, getMcpToolDefinition, listMcpToolDefinitions, getMcpReadOnlyHint, assertMcpServerAccess, listMcpResources, readMcpResource, listMcpPrompts, getMcpPrompt } from '../mcp'
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
import { resolveInsideWorkspace } from '@main/workspace/safePath'
import { commitAll } from '@main/git/git'
import { invalidateGitStatusCache } from '@main/git/gitStatusCache'
import {
  assertToolAllowedInMode,
  isPlanArtifactPath,
  isRunContractPath,
  isRunPlanPath,
  isSubagentReportPath
} from './modePolicy'
import type { AgentEvent, AgentInteractionMode, AgentQuestionRequest } from '../../../shared/ipc'
import { basename, join } from 'path'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { askQuestionThroughRenderer } from '../agentQuestion'

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
  /** Run that owns this call; required for ask_question. */
  runId?: string
  /** Provider tool-call id; required for ask_question. */
  toolCallId?: string
  /** ChatStart invoke that owns this call; scopes cancel on abort. */
  invokeId?: number
  /** Nesting level of the caller: 0 for the top-level run, 1 inside a sub-agent. */
  depth?: number
  /** Ask / Plan / Agent mode for this invoke (prefer getAgentMode when mutable). */
  agentMode?: AgentInteractionMode
  getAgentMode?: () => AgentInteractionMode
  setAgentMode?: (mode: AgentInteractionMode) => void
  /** Emit live agent events (e.g. mode_changed) while a tool is running. */
  emitAgentEvent?: (event: AgentEvent) => void
  /** Overridable in tests; defaults to renderer IPC round trip. */
  askQuestion?: (request: AgentQuestionRequest, signal: AbortSignal) => Promise<string[]>
  /** Skip write-checkpoint priors (Plan run artifacts are not workspace writes). */
  skipWriteCheckpoint?: boolean
  /** Live progress from a long-running tool, surfaced under its transcript row. */
  onProgress?: (update: { kind: 'text' | 'thinking' | 'tool' | 'done'; text: string }) => void
  /** Incremental terminal stdout/stderr for live UI streaming. */
  onTerminalOutput?: (chunk: { text: string; stream: 'stdout' | 'stderr' }) => void
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
  const fields: {
    scope: 'tools'
    code: 'TOOL_EXEC'
    tool: string
    err: unknown
    kind?: string
  } = {
    scope: 'tools',
    code: 'TOOL_EXEC',
    tool: name,
    err
  }
  const kind = toolFailureKind(err)
  if (kind) fields.kind = kind
  const summary = logErrorSummary(err, 'TOOL_EXEC')
  const line = kind
    ? `Tool execution failed: ${summary} (${kind})`
    : `Tool execution failed: ${summary}`
  if (isExpectedToolError(formatError(err))) {
    logger.warn(line, fields)
  } else {
    logger.error(line, fields)
  }
}

/** Stable, path-free classifier for tool failures (safe for structured logs). */
function toolFailureKind(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  const message = err.message ?? ''
  if (/^File not found/i.test(message)) return 'not_found'
  if (/^Not a file/i.test(message)) return 'not_a_file'
  if (/Path is a directory/i.test(message)) return 'is_directory'
  if (/Binary file detected/i.test(message)) return 'binary'
  if (/File too large/i.test(message)) return 'too_large'
  if (/Path escapes workspace/i.test(message)) return 'path_escape'
  if (/Failed to parse tool arguments/i.test(message)) return 'bad_args'
  if (err.name === 'AbortError') return 'aborted'
  const code = (err as Error & { code?: unknown }).code
  if (typeof code === 'string') return code
  return undefined
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

function formatQuestionAnswers(answers: string[]): string {
  if (answers.length === 0) return 'User provided no answer.'
  if (answers.length === 1) return `User answered: ${answers[0]}`
  return `User answered:\n${answers.map((a) => `- ${a}`).join('\n')}`
}

function resolveAgentMode(context: ToolExecutionContext): AgentInteractionMode {
  return context.getAgentMode?.() ?? context.agentMode ?? 'agent'
}

function optionalMcpServerId(args: Record<string, unknown>): string | undefined {
  const value = args.serverId ?? args.server_id
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function mcpServerGate(
  toolName: string,
  serverId: string,
  summary: string,
  context: ToolExecutionContext
): { ok: true } | { ok: false; result: ToolResult } {
  const access = assertMcpServerAccess(serverId, context.runEnabledMcpIds)
  if (!access.ok) {
    return { ok: false, result: toolFail(toolName, summary, access.error) }
  }
  return { ok: true }
}

function formatMcpResourceLines(entries: Awaited<ReturnType<typeof listMcpResources>>): string {
  return entries
    .map((entry) => {
      const label = entry.name ? `${entry.uri} (${entry.name})` : entry.uri
      const meta = [entry.mimeType, entry.description?.replace(/\s+/g, ' ').trim()]
        .filter(Boolean)
        .join(' — ')
      return `- [${entry.serverId}] ${label}${meta ? `: ${meta}` : ''}`
    })
    .join('\n')
}

function formatMcpPromptLines(entries: Awaited<ReturnType<typeof listMcpPrompts>>): string {
  return entries
    .map((entry) => {
      const argNames = (entry.arguments ?? []).map((arg) => arg.name).filter(Boolean)
      const argsNote = argNames.length ? ` args=[${argNames.join(', ')}]` : ''
      const desc = entry.description?.replace(/\s+/g, ' ').trim()
      return `- [${entry.serverId}] ${entry.name}${argsNote}${desc ? `: ${desc}` : ''}`
    })
    .join('\n')
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
    if (!context.skipWriteCheckpoint) {
      const cp = getWriteCheckpoint(context.runDir)
      if (cp) {
        for (const edit of edits) {
          if (typeof edit.path === 'string' && edit.path.trim()) {
            cp.recordPrior(edit.path, 'write')
          }
        }
      }
    }
    const content = toolMultiEdit(workspace, edits, signal)
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
  browser_navigate: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const url = String(args.url ?? '')
    const { navigateUrl } = await import('@main/app/agentBrowser')
    const content = await navigateUrl(url, {
      signal,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_navigate', url, content)
  },
  browser_snapshot: async (workspace, args, signal, context) => {
    throwIfAborted(signal)
    const { snapshotPage } = await import('@main/app/agentBrowser')
    const content = await snapshotPage({
      signal,
      maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined,
      runDir: context.runDir,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_snapshot', 'page', content)
  },
  browser_click: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const selector = String(args.selector ?? '')
    const { clickSelector } = await import('@main/app/agentBrowser')
    const button =
      args.button === 'left' || args.button === 'right' || args.button === 'middle'
        ? args.button
        : undefined
    const content = await clickSelector(selector, {
      signal,
      button,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      settleMs: typeof args.settleMs === 'number' ? args.settleMs : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_click', selector, content)
  },
  browser_type: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const text = String(args.text ?? '')
    const { typeText } = await import('@main/app/agentBrowser')
    const content = await typeText(text, {
      signal,
      selector: typeof args.selector === 'string' ? args.selector : undefined,
      clear: args.clear === true,
      pressEnter: args.pressEnter === true,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      settleMs: typeof args.settleMs === 'number' ? args.settleMs : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    const target =
      typeof args.selector === 'string' && args.selector.trim()
        ? args.selector.trim()
        : 'active element'
    return toolOk('browser_type', target, content)
  },
  browser_scroll: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const { scrollPage } = await import('@main/app/agentBrowser')
    const content = await scrollPage({
      signal,
      selector: typeof args.selector === 'string' ? args.selector : undefined,
      deltaX: typeof args.deltaX === 'number' ? args.deltaX : undefined,
      deltaY: typeof args.deltaY === 'number' ? args.deltaY : undefined,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      settleMs: typeof args.settleMs === 'number' ? args.settleMs : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    const target =
      typeof args.selector === 'string' && args.selector.trim()
        ? args.selector.trim()
        : `Δ(${Number(args.deltaX) || 0},${Number(args.deltaY) || 0})`
    return toolOk('browser_scroll', target, content)
  },
  browser_fill: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const selector = String(args.selector ?? '')
    const value = String(args.value ?? '')
    const { fillSelector } = await import('@main/app/agentBrowser')
    const content = await fillSelector(selector, value, {
      signal,
      pressEnter: args.pressEnter === true,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      settleMs: typeof args.settleMs === 'number' ? args.settleMs : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_fill', selector, content)
  },
  browser_tabs: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const action = args.action
    if (action !== 'list' && action !== 'open' && action !== 'close' && action !== 'select') {
      return toolFail('browser_tabs', 'tabs', 'action must be list|open|close|select')
    }
    const { manageTabs } = await import('@main/app/agentBrowser')
    const content = await manageTabs(action, {
      signal,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      url: typeof args.url === 'string' ? args.url : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_tabs', action, content)
  },
  browser_back: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const { goBack } = await import('@main/app/agentBrowser')
    const content = await goBack({
      signal,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_back', 'back', content)
  },
  browser_forward: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const { goForward } = await import('@main/app/agentBrowser')
    const content = await goForward({
      signal,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_forward', 'forward', content)
  },
  browser_wait_for_selector: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const selector = String(args.selector ?? '')
    const { waitForSelector } = await import('@main/app/agentBrowser')
    const content = await waitForSelector(selector, {
      signal,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_wait_for_selector', selector, content)
  },
  browser_wait_for_url: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const match = String(args.match ?? '')
    const { waitForUrl } = await import('@main/app/agentBrowser')
    const content = await waitForUrl(match, {
      signal,
      regex: args.regex === true,
      timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_wait_for_url', match.slice(0, 80), content)
  },
  browser_press_key: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const key = String(args.key ?? '')
    const { pressKey } = await import('@main/app/agentBrowser')
    const modifiers = Array.isArray(args.modifiers)
      ? args.modifiers.filter((m): m is string => typeof m === 'string')
      : undefined
    const content = await pressKey(key, {
      signal,
      modifiers,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      settleMs: typeof args.settleMs === 'number' ? args.settleMs : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_press_key', key, content)
  },
  browser_select_option: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const selector = String(args.selector ?? '')
    const { selectOption } = await import('@main/app/agentBrowser')
    const content = await selectOption(selector, {
      signal,
      value: typeof args.value === 'string' ? args.value : undefined,
      label: typeof args.label === 'string' ? args.label : undefined,
      pressEnter: args.pressEnter === true,
      tabId: typeof args.tab_id === 'string' ? args.tab_id : undefined,
      settleMs: typeof args.settleMs === 'number' ? args.settleMs : undefined,
      workspacePath: workspace
    })
    throwIfAborted(signal)
    return toolOk('browser_select_option', selector, content)
  },
  mcp_list_tools: (_workspace, args, signal) => {
    throwIfAborted(signal)
    const filter = optionalMcpServerId(args)?.toLowerCase() ?? ''
    const defs = listMcpToolDefinitions().filter((t) =>
      filter ? t.name.toLowerCase().includes(filter) : true
    )
    if (defs.length === 0) {
      return toolOk(
        'mcp_list_tools',
        filter || 'mcp',
        filter ? `No MCP tools matching serverId=${filter}` : 'No MCP tools connected.'
      )
    }
    const lines = defs.map((t) => {
      const hint = getMcpReadOnlyHint(t.name)
      const hintNote =
        hint === true ? ' readOnlyHint=true' : hint === false ? ' readOnlyHint=false' : ''
      const desc = (t.description || '').replace(/\s+/g, ' ').trim().slice(0, 160)
      return `- ${t.name}${hintNote}${desc ? `: ${desc}` : ''}`
    })
    return toolOk('mcp_list_tools', `${defs.length} tools`, lines.join('\n'))
  },
  mcp_list_resources: async (_workspace, args, signal, context) => {
    throwIfAborted(signal)
    const serverId = optionalMcpServerId(args)
    if (serverId) {
      const gate = mcpServerGate('mcp_list_resources', serverId, serverId, context)
      if (!gate.ok) return gate.result
    }
    const entries = await listMcpResources(serverId, context.runEnabledMcpIds, signal)
    if (entries.length === 0) {
      return toolOk(
        'mcp_list_resources',
        serverId || 'mcp',
        serverId ? `No MCP resources for server ${serverId}` : 'No MCP resources connected.'
      )
    }
    return toolOk(
      'mcp_list_resources',
      `${entries.length} resources`,
      formatMcpResourceLines(entries)
    )
  },
  mcp_read_resource: async (_workspace, args, signal, context) => {
    throwIfAborted(signal)
    const serverId = String(args.serverId ?? '').trim()
    const uri = String(args.uri ?? '').trim()
    if (!serverId) return toolFail('mcp_read_resource', uri || 'resource', 'serverId is required')
    if (!uri) return toolFail('mcp_read_resource', serverId, 'uri is required')
    const gate = mcpServerGate('mcp_read_resource', serverId, uri, context)
    if (!gate.ok) return gate.result
    const result = await readMcpResource(serverId, uri, signal, context.runEnabledMcpIds)
    if (!result.ok) return toolFail('mcp_read_resource', uri, result.error)
    return toolOk('mcp_read_resource', uri, result.content)
  },
  mcp_list_prompts: async (_workspace, args, signal, context) => {
    throwIfAborted(signal)
    const serverId = optionalMcpServerId(args)
    if (serverId) {
      const gate = mcpServerGate('mcp_list_prompts', serverId, serverId, context)
      if (!gate.ok) return gate.result
    }
    const entries = await listMcpPrompts(serverId, context.runEnabledMcpIds, signal)
    if (entries.length === 0) {
      return toolOk(
        'mcp_list_prompts',
        serverId || 'mcp',
        serverId ? `No MCP prompts for server ${serverId}` : 'No MCP prompts connected.'
      )
    }
    return toolOk('mcp_list_prompts', `${entries.length} prompts`, formatMcpPromptLines(entries))
  },
  mcp_get_prompt: async (_workspace, args, signal, context) => {
    throwIfAborted(signal)
    const serverId = String(args.serverId ?? '').trim()
    const name = String(args.name ?? '').trim()
    if (!serverId) return toolFail('mcp_get_prompt', name || 'prompt', 'serverId is required')
    if (!name) return toolFail('mcp_get_prompt', serverId, 'name is required')
    const gate = mcpServerGate('mcp_get_prompt', serverId, name, context)
    if (!gate.ok) return gate.result
    const promptArgs =
      args.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments)
        ? Object.fromEntries(
            Object.entries(args.arguments).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          )
        : undefined
    const result = await getMcpPrompt(serverId, name, promptArgs, signal, context.runEnabledMcpIds)
    if (!result.ok) return toolFail('mcp_get_prompt', name, result.error)
    return toolOk('mcp_get_prompt', name, result.content)
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
        parentMode: resolveAgentMode(context),
        runDir: context.runDir,
        runId: context.runId,
        invokeId: context.invokeId,
        parentToolCallId: context.toolCallId,
        emit: context.onProgress,
        onContextUsage: context.onSubagentContextUsage
      })
    } catch (err) {
      if (err instanceof SubagentDepthError) return toolFail('subagent', summary, err.message)
      throw err
    }
    const persisted = outcome.reportRel
      ? `Persisted report: ${outcome.reportRel} (re-read with \`read\` after compaction).\n\n`
      : ''
    if (!outcome.ok) return toolFail('subagent', summary, `${persisted}${outcome.report}`)
    return toolOk('subagent', summary, `${persisted}${outcome.report}`)
  },
  ask_question: async (_workspace, args, signal, context) => {
    throwIfAborted(signal)
    const question = String(args.question ?? '').trim()
    if (!question) return toolFail('ask_question', 'question', 'question is required')
    if (!context.runId || !context.toolCallId) {
      return toolFail('ask_question', question, 'ask_question requires an active run')
    }
    const options = Array.isArray(args.options)
      ? args.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
      : undefined
    const request: AgentQuestionRequest = {
      requestId: randomUUID(),
      runId: context.runId,
      toolCallId: context.toolCallId,
      question,
      ...(options?.length ? { options } : {}),
      ...(args.allowMultiple === true ? { allowMultiple: true } : {}),
      ...(args.allowCustom === false ? { allowCustom: false } : {})
    }
    const ask =
      context.askQuestion ??
      ((req, sig) => askQuestionThroughRenderer(req, sig, context.invokeId))
    try {
      const answers = await ask(request, signal)
      return toolOk('ask_question', question.slice(0, 80), formatQuestionAnswers(answers))
    } catch (err) {
      if (isAbortError(err)) throw err
      const message = err instanceof Error ? err.message : 'Question failed'
      return toolFail('ask_question', question.slice(0, 80), message)
    }
  },
  switch_mode: (_workspace, args, signal, context) => {
    throwIfAborted(signal)
    const mode = args.mode
    if (mode !== 'ask' && mode !== 'plan' && mode !== 'agent') {
      return toolFail('switch_mode', 'mode', 'mode must be ask, plan, or agent')
    }
    const previous = resolveAgentMode(context)
    context.setAgentMode?.(mode)
    if (context.runId) {
      context.emitAgentEvent?.({ type: 'mode_changed', runId: context.runId, mode })
    }
    const content =
      previous === mode
        ? `Already in ${mode} mode.`
        : `Mode switched from ${previous} to ${mode}. Tool availability updated for subsequent steps.`
    return toolOk('switch_mode', mode, content)
  },
  terminal: async (workspace, args, signal, context) => {
    const sessionId =
      typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id.trim()
        : ''
    const command = typeof args.command === 'string' ? args.command : ''
    const shell = getSettings().terminalShell ?? 'auto'
    const pattern = typeof args.pattern === 'string' ? args.pattern : undefined
    const useSessionApi = Boolean(sessionId) || typeof args.block_until_ms === 'number'
    const onOutput = context.onTerminalOutput
    const workingDirectory =
      typeof args.working_directory === 'string' && args.working_directory.trim()
        ? args.working_directory.trim()
        : ''
    const cwd = workingDirectory
      ? resolveInsideWorkspace(workspace, workingDirectory)
      : workspace

    if (useSessionApi) {
      const runId = context.runId
      const invokeId = context.invokeId
      if (!runId || !invokeId) {
        return toolFail('terminal', 'session', 'Background terminal requires run ownership')
      }
      const { startBackgroundTerminal, pollTerminalSession } = await import('./terminalSessions')
      const blockUntilMs =
        typeof args.block_until_ms === 'number' ? args.block_until_ms : sessionId ? 30_000 : 0
      const content = sessionId
        ? await pollTerminalSession({
            runId,
            invokeId,
            sessionId,
            blockUntilMs,
            pattern,
            signal,
            onOutput
          })
        : await startBackgroundTerminal({
            runId,
            invokeId,
            workspaceRoot: workspace,
            cwd,
            command,
            signal,
            shell,
            pattern,
            blockUntilMs,
            onOutput
          })
      const summary = (command || sessionId).slice(0, 80)
      const ok = terminalResultOk(command || 'session', content)
      if (ok) return toolOk('terminal', summary, content)
      return toolFail('terminal', summary, content)
    }

    const requested = typeof args.timeoutMs === 'number' ? args.timeoutMs : 60_000
    const timeoutMs = Math.min(TERMINAL_MAX_TIMEOUT_MS, Math.max(1, requested))
    const content = await toolTerminal(workspace, command, signal, {
      timeoutMs,
      shell,
      cwd,
      onOutput
    })
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
  git_commit: async (workspace, args, signal) => {
    throwIfAborted(signal)
    const message = String(args.message ?? '').trim()
    if (!message) return toolFail('git_commit', 'git commit', 'Commit message is required')
    const push = args.push === true
    try {
      const outcome = await commitAll(workspace, message, push)
      invalidateGitStatusCache(workspace)
      const summary = push ? 'git commit + push' : 'git commit'
      const content = [
        outcome.detail,
        `committed: ${outcome.committed}`,
        `pushed: ${outcome.pushed}`,
        `message: ${message}`
      ].join('\n')
      return toolOk('git_commit', summary, content)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return toolFail('git_commit', 'git commit', msg)
    }
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

  const agentMode: AgentInteractionMode = resolveAgentMode(context)

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

  // Remap run artifacts to the run directory (not the workspace root):
  // Plan: plan.md + contract.md; Agent: contract.md + existing plan.md;
  // Any mode: subagents/<id>/report.md|status.json (file-backed subagent reports).
  let effectiveWorkspace = workspace
  let effectiveArgs = args
  let effectiveContext = context

  const shouldRemapPath = (pathArg: string): boolean => {
    if (!pathArg) return false
    if (isSubagentReportPath(pathArg)) return true
    if (agentMode === 'plan' && isPlanArtifactPath(pathArg)) return true
    if (agentMode === 'agent' && isRunContractPath(pathArg)) return true
    if (
      agentMode === 'agent' &&
      isRunPlanPath(pathArg) &&
      context.runDir &&
      existsSync(join(context.runDir, 'plan.md'))
    ) {
      return true
    }
    return false
  }

  const remapPathArg = (pathArg: string): string => {
    const n = pathArg.replace(/\\/g, '/').replace(/^\.\//, '')
    if (isSubagentReportPath(n)) return n
    return basename(n)
  }

  if (name === 'multi_edit' && Array.isArray(args.edits)) {
    const edits = args.edits as Array<Record<string, unknown>>
    let anyRemap = false
    const remapped = edits.map((edit) => {
      const p = typeof edit.path === 'string' ? edit.path : ''
      if (!shouldRemapPath(p)) return edit
      anyRemap = true
      return { ...edit, path: remapPathArg(p) }
    })
    if (anyRemap) {
      if (!context.runDir) {
        return toolFail(name, summary, 'Run artifacts require an active run directory')
      }
      effectiveWorkspace = context.runDir
      effectiveArgs = { ...args, edits: remapped }
      effectiveContext = { ...context, skipWriteCheckpoint: true }
    }
  } else {
    const pathArg = typeof args.path === 'string' ? args.path : ''
    const remapRunArtifact =
      (name === 'edit' || name === 'str_replace' || name === 'read') && shouldRemapPath(pathArg)
    if (remapRunArtifact) {
      if (!context.runDir) {
        return toolFail(name, summary, 'Run artifacts require an active run directory')
      }
      // Subagent reports are read-only via remapping (edits stay on contract/plan only).
      if (
        (name === 'edit' || name === 'str_replace') &&
        isSubagentReportPath(pathArg) &&
        !isPlanArtifactPath(pathArg) &&
        !isRunContractPath(pathArg)
      ) {
        return toolFail(
          name,
          summary,
          'Sub-agent reports are read-only. Use `read` on subagents/<id>/report.md.'
        )
      }
      effectiveWorkspace = context.runDir
      effectiveArgs = { ...args, path: remapPathArg(pathArg) }
      if (name === 'edit' || name === 'str_replace') {
        effectiveContext = { ...context, skipWriteCheckpoint: true }
      }
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
