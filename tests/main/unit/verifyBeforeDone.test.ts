import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/ipc'

const toolDiagnosticsAsync = vi.fn()

vi.mock('@main/agent/tools/diagnostics', () => ({
  parseDiagnosticLines: (text: string) => {
    if (text.includes('error TS')) {
      return [{ file: 'a.ts', line: 1, col: 1, severity: 'error', message: 'bad' }]
    }
    return []
  },
  toolDiagnosticsAsync: (...args: unknown[]) => toolDiagnosticsAsync(...args)
}))

import {
  runHasDiagnosticsEvidence,
  shouldNudgeVerifyBeforeDone,
  verifyNudgeMessage,
  externalDiagnosticsCheck
} from '@main/agent/verifyBeforeDone'

describe('verifyBeforeDone', () => {
  it('detects clean diagnostics tool evidence only', () => {
    const messages: ChatMessage[] = [
      { role: 'tool', toolCallId: '1', toolName: 'diagnostics', ok: true, content: 'ok' },
      { role: 'tool', toolCallId: '2', toolName: 'read', ok: true, content: 'x' }
    ]
    expect(runHasDiagnosticsEvidence(messages)).toBe(true)
    expect(
      runHasDiagnosticsEvidence([
        { role: 'tool', toolCallId: '1', toolName: 'diagnostics', ok: false, content: 'fail' }
      ])
    ).toBe(false)
    expect(runHasDiagnosticsEvidence([])).toBe(false)
  })

  it('treats ok:true with error-severity lines as not evidence', () => {
    expect(
      runHasDiagnosticsEvidence([
        {
          role: 'tool',
          toolCallId: '1',
          toolName: 'diagnostics',
          ok: true,
          content: 'a.ts(1,1): error TS2322: Type bad'
        }
      ])
    ).toBe(false)
  })

  it('nudges only in agent mode with notice/require when lacking evidence', () => {
    expect(
      shouldNudgeVerifyBeforeDone({
        verifyMode: 'off',
        agentMode: 'agent',
        hasEvidence: false,
        alreadyNudged: false,
        incomplete: undefined
      })
    ).toBe(false)
    expect(
      shouldNudgeVerifyBeforeDone({
        verifyMode: 'notice',
        agentMode: 'ask',
        hasEvidence: false,
        alreadyNudged: false,
        incomplete: undefined
      })
    ).toBe(false)
    expect(
      shouldNudgeVerifyBeforeDone({
        verifyMode: 'notice',
        agentMode: 'agent',
        hasEvidence: true,
        alreadyNudged: false,
        incomplete: undefined
      })
    ).toBe(false)
    expect(
      shouldNudgeVerifyBeforeDone({
        verifyMode: 'notice',
        agentMode: 'agent',
        hasEvidence: false,
        alreadyNudged: true,
        incomplete: undefined
      })
    ).toBe(false)
    expect(
      shouldNudgeVerifyBeforeDone({
        verifyMode: 'require',
        agentMode: 'agent',
        hasEvidence: false,
        alreadyNudged: true,
        incomplete: undefined
      })
    ).toBe(true)
    expect(
      shouldNudgeVerifyBeforeDone({
        verifyMode: 'require',
        agentMode: 'agent',
        hasEvidence: false,
        alreadyNudged: false,
        incomplete: 'truncated'
      })
    ).toBe(false)
    expect(
      shouldNudgeVerifyBeforeDone({
        verifyMode: 'notice',
        agentMode: 'agent',
        hasEvidence: false,
        alreadyNudged: false,
        incomplete: undefined
      })
    ).toBe(true)
  })

  it('builds distinct notice vs require nudge copy', () => {
    expect(verifyNudgeMessage('notice')).toMatch(/soft reminder/i)
    expect(verifyNudgeMessage('require')).toMatch(/cannot finish while typecheck is dirty/i)
    expect(verifyNudgeMessage('require')).toMatch(/clean `diagnostics`/i)
    expect(verifyNudgeMessage('require', 'errors here')).toMatch(/errors here/)
  })

  it('externalDiagnosticsCheck reports clean vs dirty typecheck', async () => {
    toolDiagnosticsAsync.mockResolvedValueOnce({ ok: true, content: 'command: tsc\n\nok' })
    await expect(externalDiagnosticsCheck('/ws', new AbortController().signal)).resolves.toEqual(
      expect.objectContaining({ clean: true })
    )

    toolDiagnosticsAsync.mockResolvedValueOnce({
      ok: false,
      content: 'a.ts(1,1): error TS2322: Type bad'
    })
    const dirty = await externalDiagnosticsCheck('/ws', new AbortController().signal)
    expect(dirty.clean).toBe(false)
    expect(dirty.excerpt).toMatch(/error/i)
  })
})
