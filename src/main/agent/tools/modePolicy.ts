import { basename, normalize } from 'path'
import type { AgentInteractionMode } from '../../../shared/ipc'
import { getMcpReadOnlyHint, parseMcpToolName } from '../mcp'
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
  // Browse-only: click/type/fill can submit forms and mutate live sites.
  'browser_navigate',
  'browser_snapshot',
  'browser_scroll',
  'memory_list',
  'memory_read',
  'subagent',
  'git_status',
  'git_diff',
  'diagnostics'
])

/** Plan mode also allows todos + plan-artifact edits. */
const PLAN_EXTRA_BUILTIN = new Set(['todo_write', 'edit', 'str_replace'])

/** Filenames Plan mode may write inside the run directory. */
export const PLAN_ARTIFACT_NAMES = new Set(['contract.md', 'plan.md'])

export function isPlanArtifactPath(pathArg: string): boolean {
  const base = basename(normalize(pathArg.replace(/\\/g, '/')))
  return PLAN_ARTIFACT_NAMES.has(base)
}

export function modeSectionMarkdown(mode: AgentInteractionMode): string | null {
  switch (mode) {
    case 'agent':
      return null
    case 'ask':
      return [
        '## Mode: Ask',
        '',
        'You are in Ask mode. Investigate and answer using read-only tools only',
        '(built-ins plus MCP tools that declare readOnlyHint).',
        'Do not edit files, delete paths, run shell commands, or write memory.',
        'If the user needs changes, explain what you would do and suggest switching to Agent mode.'
      ].join('\n')
    case 'plan':
      return [
        '## Mode: Plan',
        '',
        'You are in Plan mode. Explore the codebase with read-only tools (and read-only MCP),',
        'maintain todos via `todo_write`,',
        'and write or refine only `plan.md` and `contract.md` (run plan artifacts — not product source).',
        'Do not edit application code, delete files, or run the terminal.',
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
  if (ASK_SAFE_BUILTIN.has(name)) return true
  if (mode === 'plan' && PLAN_EXTRA_BUILTIN.has(name)) return true
  return false
}

/**
 * MCP tools in Ask/Plan: only when the server declared `readOnlyHint: true`.
 * Hint is still untrusted for parallel/approval exemption (see classify.ts).
 */
export function isMcpAllowedInMode(mode: AgentInteractionMode, fullName: string): boolean {
  if (mode === 'agent') return true
  return getMcpReadOnlyHint(fullName) === true
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
        error: `${mode === 'ask' ? 'Ask' : 'Plan'} mode only allows MCP tools with readOnlyHint. "${name}" is not read-only (or hint unknown). Switch to Agent mode.`
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
  'browser_scroll'
])

export function askSafeAlignsWithParallelSafe(): boolean {
  for (const name of ASK_SAFE_BUILTIN) {
    if (!isParallelSafeTool(name) && !ASK_SAFE_SERIAL_OK.has(name)) return false
  }
  return true
}
