import type { AgentInteractionMode, ChatMessage, IncompleteReason } from '../../shared/ipc'
import type { VerifyBeforeDoneMode } from '../../shared/ipc'
import { parseDiagnosticLines, toolDiagnosticsAsync } from './tools/diagnostics'

export type VerifyNudgeKind = 'notice' | 'require'

/** True when this run already has a successful `diagnostics` tool result. */
export function runHasDiagnosticsEvidence(messages: readonly ChatMessage[]): boolean {
  for (const msg of messages) {
    if (msg.role !== 'tool') continue
    if (msg.toolName !== 'diagnostics') continue
    if (msg.ok === false) continue
    return true
  }
  return false
}

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
  if (opts.alreadyNudged) return false
  return true
}

export function verifyNudgeMessage(kind: VerifyNudgeKind, extras?: string): string {
  const base =
    kind === 'require'
      ? [
          'Verify-before-done is set to require. Before finishing, run `diagnostics`',
          '(typecheck and/or lint) and confirm the run contract Done-when criteria,',
          'or explain blockers clearly. Then continue or stop with tools when done.'
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
} {
  let calls = 0
  let ok = 0
  for (const msg of messages) {
    if (msg.role !== 'tool' || msg.toolName !== 'diagnostics') continue
    calls++
    if (msg.ok !== false) ok++
  }
  return { calls, ok }
}
