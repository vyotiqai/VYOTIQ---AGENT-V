import { existsSync } from 'fs'
import type { AgentInteractionMode, IncompleteReason } from '../../shared/ipc'
import type { ContractDoneWhenMode } from '../../shared/ipc'
import { resolveInsideWorkspace } from '../workspace/safePath'
import { externalDiagnosticsCheck } from './verifyBeforeDone'

export type ContractDoneWhenNudgeKind = 'notice' | 'require'

export type ContractCriterion =
  | { kind: 'file_exists'; path: string; bullet: string }
  | { kind: 'typecheck_clean'; bullet: string }

export type CriterionResult = {
  criterion: ContractCriterion
  met: boolean
  detail: string
}

const TYPECHECK_RE = /typecheck|type-check|\btsc\b|diagnostics|type\s+errors?/i
const BACKTICK_PATH_RE = /`([^`]+)`/g
/** Workspace-ish path tokens: prefix dirs or file extensions. */
const PATH_TOKEN_RE =
  /(?:^|[\s(,:[])((?:src|tests?|resources|docs|scripts|\.vyotiq)\/[^\s`"'<>|]+|[^\s`"'<>|]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|html|py|rs|go|yml|yaml))\b/gi

/** Extract bullet lines under `## Done when` (until next ## heading or EOF). */
export function parseDoneWhenBullets(contractText: string): string[] {
  const text = contractText.trim()
  if (!text) return []
  const doneIdx = text.search(/^##\s*Done when\b/im)
  if (doneIdx < 0) return []
  const after = text.slice(doneIdx)
  const nextHeading = after.search(/\n##\s+/m)
  const section = nextHeading >= 0 ? after.slice(0, nextHeading) : after
  const bullets: string[] = []
  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+)$/)
    if (m?.[1]?.trim()) bullets.push(m[1].trim())
  }
  return bullets
}

function looksLikePath(raw: string): boolean {
  const s = raw.trim().replace(/[.,;:!?)]+$/, '')
  if (!s || s.includes('://') || s.startsWith('#')) return false
  if (s.includes(' ')) return false
  if (/^(src|tests?|resources|docs|scripts|\.vyotiq)\//i.test(s)) return true
  if (/\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html|py|rs|go|yml|yaml)$/i.test(s)) return true
  return false
}

function normalizeRelPath(raw: string): string {
  return raw
    .trim()
    .replace(/[.,;:!?)]+$/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
}

/**
 * Map Done-when bullets to objective criteria.
 * Subjective bullets (no path / typecheck language) are skipped.
 */
export function parseCheckableCriteria(bullets: readonly string[]): ContractCriterion[] {
  const out: ContractCriterion[] = []
  const seenFiles = new Set<string>()
  let hasTypecheck = false

  for (const bullet of bullets) {
    if (TYPECHECK_RE.test(bullet)) {
      if (!hasTypecheck) {
        out.push({ kind: 'typecheck_clean', bullet })
        hasTypecheck = true
      }
    }

    const paths = new Set<string>()
    for (const m of bullet.matchAll(BACKTICK_PATH_RE)) {
      const p = normalizeRelPath(m[1] ?? '')
      if (looksLikePath(p)) paths.add(p)
    }
    for (const m of bullet.matchAll(PATH_TOKEN_RE)) {
      const p = normalizeRelPath(m[1] ?? '')
      if (looksLikePath(p)) paths.add(p)
    }
    for (const path of paths) {
      const key = path.toLowerCase()
      if (seenFiles.has(key)) continue
      seenFiles.add(key)
      out.push({ kind: 'file_exists', path, bullet })
    }
  }
  return out
}

/** Evaluate checkable criteria against the workspace (and optional typecheck). */
export async function evaluateContractCriteria(
  workspace: string,
  criteria: readonly ContractCriterion[],
  signal: AbortSignal
): Promise<CriterionResult[]> {
  const results: CriterionResult[] = []
  let typecheckCache: { clean: boolean; excerpt: string } | undefined

  for (const criterion of criteria) {
    if (signal.aborted) break
    if (criterion.kind === 'file_exists') {
      try {
        const abs = resolveInsideWorkspace(workspace, criterion.path)
        const met = existsSync(abs)
        results.push({
          criterion,
          met,
          detail: met
            ? `File exists: ${criterion.path}`
            : `Missing file: ${criterion.path}`
        })
      } catch (err) {
        results.push({
          criterion,
          met: false,
          detail: `Invalid path ${criterion.path}: ${err instanceof Error ? err.message : String(err)}`
        })
      }
      continue
    }

    if (!typecheckCache) {
      typecheckCache = await externalDiagnosticsCheck(workspace, signal)
    }
    results.push({
      criterion,
      met: typecheckCache.clean,
      detail: typecheckCache.clean
        ? 'Typecheck is clean'
        : typecheckCache.excerpt
    })
  }
  return results
}

export function unmetCriteriaSummaries(results: readonly CriterionResult[], cap = 8): string[] {
  return results
    .filter((r) => !r.met)
    .slice(0, cap)
    .map((r) => {
      if (r.criterion.kind === 'file_exists') {
        return `file_exists:${r.criterion.path}`
      }
      return 'typecheck_clean'
    })
}

/**
 * Soft contract Done-when gate before accepting a no-tool finish.
 * - `notice`: at most one nudge (`alreadyNudged` blocks repeats)
 * - `require`: keep nudging while any checkable criterion is unmet
 * - No checkable criteria → never nudge (subjective bullets stay advisory)
 */
export function shouldNudgeContractDoneWhen(opts: {
  mode: ContractDoneWhenMode
  agentMode: AgentInteractionMode
  criteria: readonly ContractCriterion[]
  results: readonly CriterionResult[]
  alreadyNudged: boolean
  incomplete: IncompleteReason | undefined
}): boolean {
  if (opts.mode === 'off') return false
  if (opts.agentMode !== 'agent') return false
  if (opts.incomplete) return false
  if (opts.criteria.length === 0) return false
  // Incomplete evaluation (e.g. abort mid-loop) must not vacuous-pass via [].every().
  if (
    opts.results.length === opts.criteria.length &&
    opts.results.every((r) => r.met)
  ) {
    return false
  }
  if (opts.mode === 'notice' && opts.alreadyNudged) return false
  return true
}

export function contractDoneWhenNudgeMessage(
  kind: ContractDoneWhenNudgeKind,
  failures: readonly CriterionResult[]
): string {
  const lines = failures
    .filter((r) => !r.met)
    .map((r) => {
      const label =
        r.criterion.kind === 'file_exists'
          ? `file exists (\`${r.criterion.path}\`)`
          : 'typecheck clean'
      return `- Unmet (${label}): ${r.detail}\n  From: ${r.criterion.bullet}`
    })
  const list = lines.length > 0 ? lines.join('\n') : '- (criteria unmet)'

  if (kind === 'require') {
    return [
      'Contract done-when is set to require. You cannot finish while checkable',
      'Done-when criteria from `contract.md` are unmet (paths that must exist',
      'and/or typecheck). Fix them, update the contract if scope changed, then',
      'finish only when those criteria pass.',
      '',
      list
    ].join('\n')
  }
  return [
    'Before finishing, checkable Done-when criteria from `contract.md` look unmet.',
    'This is a soft reminder — you may finish after addressing them, or explain',
    'why they no longer apply (and update the contract).',
    '',
    list
  ].join('\n')
}
