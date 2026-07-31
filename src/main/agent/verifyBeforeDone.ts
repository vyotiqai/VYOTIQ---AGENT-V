import type { AgentInteractionMode, ChatMessage, IncompleteReason, VerifyBeforeDoneMode } from '../../shared/ipc'
import { contentToText } from '../../shared/ipc'
import { isFileMutationToolName } from './loopPolicy'
import { parseDiagnosticLines, toolDiagnosticsAsync } from './tools/diagnostics'

export type VerifyNudgeKind = 'notice' | 'require'

/**
 * True when this run has clean diagnostics evidence newer than its latest
 * successful file mutation.
 * `ok: true` with parsed errors is not evidence.
 */
export function runHasDiagnosticsEvidence(messages: readonly ChatMessage[]): boolean {
  let cleanEvidence = false
  for (const msg of messages) {
    if (msg.role !== 'tool') continue
    if (msg.ok !== false && msg.toolName && isFileMutationToolName(msg.toolName)) {
      cleanEvidence = false
      continue
    }
    if (msg.toolName === 'diagnostics' && msg.ok !== false) {
      const text = contentToText(msg.content ?? '')
      const items = parseDiagnosticLines(text)
      const errors = items.filter((d) => (d.severity ?? 'error') === 'error')
      cleanEvidence = errors.length === 0
    }
  }
  return cleanEvidence
}

/**
 * Soft verify gate before accepting a no-tool finish.
 * - `notice`: at most one nudge (`alreadyNudged` blocks repeats)
 * - `require`: keep nudging until clean diagnostics evidence exists; the loop
 *   applies a circuit breaker (`MAX_REQUIRE_FINISH_NUDGES`) so this cannot spin forever
 */
export function shouldNudgeVerifyBeforeDone(opts: {
  verifyMode: VerifyBeforeDoneMode
  agentMode: AgentInteractionMode
  hasEvidence: boolean
  alreadyNudged: boolean
  incomplete: IncompleteReason | undefined
}): boolean {
  if (opts.verifyMode === 'off') return false
  if (opts.agentMode !== 'agent') return false
  if (opts.incomplete) return false
  if (opts.hasEvidence) return false
  if (opts.verifyMode === 'notice' && opts.alreadyNudged) return false
  return true
}

export function verifyNudgeMessage(kind: VerifyNudgeKind, extras?: string): string {
  const base =
    kind === 'require'
      ? [
          'Verify-before-done is set to require. You cannot finish while typecheck is dirty',
          'and this run has no clean `diagnostics` result (ok with no error-severity lines).',
          'Fix errors, run `diagnostics` (typecheck; lint optional), and re-check the run',
          'contract Done-when criteria. Finishing is blocked until typecheck is clean.'
        ].join(' ')
      : [
          'Before finishing, prefer verifying against the run contract (re-read outcomes,',
          '`diagnostics`, or a focused test). This is a soft reminder — you may finish',
          'after one check, or explain why verification is not needed.'
        ].join(' ')
  const extra = extras?.trim()
  return extra ? `${base}\n\n${extra}` : base
}

/**
 * For `require` mode: run typecheck once outside the model loop.
 * Returns clean=true when the command succeeds with no parsed error diagnostics.
 */
export async function externalDiagnosticsCheck(
  workspace: string,
  signal: AbortSignal
): Promise<{ clean: boolean; excerpt: string }> {
  const result = await toolDiagnosticsAsync(workspace, 'typecheck', signal)
  const text = result.content
  const items = parseDiagnosticLines(text)
  const errors = items.filter((d) => (d.severity ?? 'error') === 'error')
  if (result.ok && errors.length === 0) {
    return { clean: true, excerpt: text.slice(0, 400) }
  }
  const lines = errors.slice(0, 12).map(
    (d) => `${d.file}:${d.line}:${d.col}: ${d.severity ?? 'error'}: ${d.message}`
  )
  const more = errors.length > 12 ? `\n… (+${errors.length - 12} more)` : ''
  const excerpt =
    lines.length > 0
      ? `External typecheck found ${errors.length} error(s):\n${lines.join('\n')}${more}`
      : `External typecheck did not pass:\n${text.slice(0, 1200)}`
  return { clean: false, excerpt }
}

/** Count diagnostics tool outcomes for receipts. */
export function countDiagnosticsCalls(messages: readonly ChatMessage[]): {
  calls: number
  ok: number
  clean: number
} {
  let calls = 0
  let ok = 0
  let clean = 0
  for (const msg of messages) {
    if (msg.role !== 'tool' || msg.toolName !== 'diagnostics') continue
    calls++
    if (msg.ok !== false) {
      ok++
      const items = parseDiagnosticLines(contentToText(msg.content ?? ''))
      if (!items.some((d) => (d.severity ?? 'error') === 'error')) clean++
    }
  }
  return { calls, ok, clean }
}
