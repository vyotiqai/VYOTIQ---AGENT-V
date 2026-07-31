import { basename, normalize } from 'path'
import type { AgentInteractionMode } from '../../../shared/ipc'
import { parseMcpToolName } from '../mcp'
import { isParallelSafeTool } from './classify'

/** Built-in tools allowed in Ask mode (read-only / parallel-safe). */
export const ASK_SAFE_BUILTIN = new Set([
  'read',
  'search',
  'glob',
  'grep',
  'list_dir',
  'web_fetch',
  'web_search',
  'ask_question',
  // Browse-only: click/type/fill/press_key/select can mutate live sites.
  'browser_navigate',
  'browser_snapshot',
  'browser_scroll',
  'browser_tabs',
  'browser_back',
  'browser_forward',
  'browser_wait_for_selector',
  'browser_wait_for_url',
  'mcp_list_tools',
  'mcp_list_resources',
  'mcp_read_resource',
  'mcp_list_prompts',
  'mcp_get_prompt',
  'memory_list',
  'memory_read',
  'subagent',
  'git_status',
  'git_diff'
  // `diagnostics` spawns a shell — Plan-only (see PLAN_EXTRA / agent), not Ask.
])

/** Plan mode also allows todos + plan-artifact edits + diagnostics. */
const PLAN_EXTRA_BUILTIN = new Set(['todo_write', 'edit', 'str_replace', 'multi_edit', 'diagnostics'])

/** Built-ins allowed in Ask but not Plan (avoid nested research loops while planning). */
const PLAN_EXCLUDED_BUILTIN = new Set(['subagent'])

/** Allowed in every interaction mode (not read-only, but mode control). */
const ALL_MODE_BUILTIN = new Set(['switch_mode'])

/** Filenames Plan mode may write inside the run directory. */
export const PLAN_ARTIFACT_NAMES = new Set(['contract.md', 'plan.md'])

export function isPlanArtifactPath(pathArg: string): boolean {
  const base = basename(normalize(pathArg.replace(/\\/g, '/')))
  return PLAN_ARTIFACT_NAMES.has(base)
}

/** Run contract file — remapped to the run directory in Plan and Agent modes. */
export function isRunContractPath(pathArg: string): boolean {
  const base = basename(normalize(pathArg.replace(/\\/g, '/')))
  return base === 'contract.md'
}

/** Sub-agent durable reports under the run directory (`subagents/<id>/report.md`). */
export function isSubagentReportPath(pathArg: string): boolean {
  const n = pathArg.replace(/\\/g, '/').replace(/^\.\//, '')
  return /^subagents\/[^/]+\/(report\.md|status\.json)$/i.test(n)
}

/** Run plan.md — remapped in Plan always; in Agent when a run plan artifact exists. */
export function isRunPlanPath(pathArg: string): boolean {
  const base = basename(normalize(pathArg.replace(/\\/g, '/')))
  return base === 'plan.md'
}

export function modeSectionMarkdown(mode: AgentInteractionMode): string | null {
  switch (mode) {
    case 'agent':
      return [
        '## Mode: Agent',
        '',
        'You are in Agent mode. You may edit files, run the `terminal` tool, write memory,',
        'and use the full tools catalog (subject to user approval settings).',
        'Workspace writes are checkpointed for Keep/Discard; plan.md / contract.md run',
        'artifacts are not. Prefer non-destructive commands.',
            'After edits or commands, verify against the goal (re-read, `diagnostics`, or a',
            'focused test via `terminal`). Settings may soft-nudge once before a no-tool finish.',
            'You may delegate broad research with `subagent`;',
            'the parent alone edits and uses the `terminal` tool.',
        'Follow the run contract; if an approved `## Plan` is present, implement it unless',
        'the user redirects you. Use `ask_question` for ambiguous product decisions and',
        '`switch_mode` if Ask or Plan fits better.'
      ].join('\n')
    case 'ask':
      return [
        '## Mode: Ask',
        '',
        'You are in Ask mode. Use read-only built-in tools liberally to investigate and answer.',
        'MCP tools are not available in Ask mode (server-reported readOnlyHint is untrusted).',
        'Only avoid mutating tools. Do not edit files, delete paths, run the `terminal` tool,',
        'run `diagnostics`, or write memory. `subagent` is allowed for broad read-only research.',
        'If the user needs changes, explain what you would do and suggest switching to Agent mode.'
      ].join('\n')
    case 'plan':
      return [
        '## Mode: Plan',
        '',
        'You are in Plan mode. Explore with read-only built-in tools',
        '(MCP tools are not available — readOnlyHint is untrusted as a security gate),',
        'update `plan.md` and `contract.md` incrementally (run plan artifacts — not product source),',
        'and keep todos via `todo_write`. Prefer updating the injected `## Plan` rather than',
        're-deriving it from scratch each turn.',
        '`diagnostics` is allowed. Do not edit application code, delete files, run the `terminal`',
        'tool, or spawn `subagent` (not Plan).',
        'End with a clear plan the user can approve by switching to Agent mode.'
      ].join('\n')
    default: {
      const _exhaustive: never = mode
      return _exhaustive
    }
  }
}

export function isBuiltinAllowedInMode(mode: AgentInteractionMode, name: string): boolean {
  if (mode === 'agent') return true
  if (ALL_MODE_BUILTIN.has(name)) return true
  if (mode === 'plan' && PLAN_EXCLUDED_BUILTIN.has(name)) return false
  if (ASK_SAFE_BUILTIN.has(name)) return true
  if (mode === 'plan' && PLAN_EXTRA_BUILTIN.has(name)) return true
  return false
}

/**
 * MCP tools are Agent-mode only. Server-reported `readOnlyHint` is untrusted
 * as a security gate (see classify.ts) — never use it to allow Ask/Plan.
 */
export function isMcpAllowedInMode(mode: AgentInteractionMode, _fullName: string): boolean {
  return mode === 'agent'
}

export function filterToolDefsForMode<T extends { name: string }>(
  mode: AgentInteractionMode,
  defs: T[]
): T[] {
  if (mode === 'agent') return defs
  return defs.filter((t) => {
    if (parseMcpToolName(t.name)) return isMcpAllowedInMode(mode, t.name)
    return isBuiltinAllowedInMode(mode, t.name)
  })
}

export type ModeDenyResult = { ok: true } | { ok: false; error: string }

/**
 * Hard gate before executing a tool. Plan edit/str_replace must target plan artifacts.
 */
export function assertToolAllowedInMode(
  mode: AgentInteractionMode,
  name: string,
  args: Record<string, unknown>
): ModeDenyResult {
  if (mode === 'agent') return { ok: true }

  const mcp = parseMcpToolName(name)
  if (mcp) {
    if (!isMcpAllowedInMode(mode, name)) {
      return {
        ok: false,
        error: `${mode === 'ask' ? 'Ask' : 'Plan'} mode does not allow MCP tools. "${name}" requires Agent mode.`
      }
    }
    return { ok: true }
  }

  if (!isBuiltinAllowedInMode(mode, name)) {
    return {
      ok: false,
      error: `${mode === 'ask' ? 'Ask' : 'Plan'} mode does not allow tool "${name}". Switch to Agent mode to make changes.`
    }
  }

  if (mode === 'plan' && (name === 'edit' || name === 'str_replace')) {
    const path = typeof args.path === 'string' ? args.path : ''
    if (!isPlanArtifactPath(path)) {
      return {
        ok: false,
        error:
          'Plan mode may only edit plan.md or contract.md (run plan artifacts). Switch to Agent mode to edit product code.'
      }
    }
  }

  if (mode === 'plan' && name === 'multi_edit') {
    const edits = Array.isArray(args.edits) ? args.edits : []
    for (const entry of edits) {
      const path =
        entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string'
          ? (entry as { path: string }).path
          : ''
      if (!isPlanArtifactPath(path)) {
        return {
          ok: false,
          error:
            'Plan mode multi_edit may only target plan.md or contract.md. Switch to Agent mode to edit product code.'
        }
      }
    }
  }

  return { ok: true }
}

/** Sanity: Ask-safe set should match parallel-safe built-ins used for reads. */
/**
 * Ask-safe tools are normally parallel-safe. Exception: agent-browser tools share
 * one BrowserWindow and must stay serial while remaining Ask-readable.
 */
const ASK_SAFE_SERIAL_OK = new Set([
  'browser_navigate',
  'browser_snapshot',
  'browser_scroll',
  'browser_tabs',
  'browser_back',
  'browser_forward',
  'browser_wait_for_selector',
  'browser_wait_for_url',
  'ask_question',
  'mcp_list_resources',
  'mcp_read_resource',
  'mcp_list_prompts',
  'mcp_get_prompt'
])

export function askSafeAlignsWithParallelSafe(): boolean {
  for (const name of ASK_SAFE_BUILTIN) {
    if (!isParallelSafeTool(name) && !ASK_SAFE_SERIAL_OK.has(name)) return false
  }
  return true
}
