import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  parseDoneWhenBullets,
  parseCheckableCriteria,
  evaluateContractCriteria,
  shouldNudgeContractDoneWhen,
  contractDoneWhenNudgeMessage,
  unmetCriteriaSummaries
} from '@main/agent/contractDoneWhen'

const { externalDiagnosticsCheck } = vi.hoisted(() => ({
  externalDiagnosticsCheck: vi.fn()
}))

vi.mock('@main/agent/verifyBeforeDone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/verifyBeforeDone')>()
  return {
    ...actual,
    externalDiagnosticsCheck: (...args: unknown[]) => externalDiagnosticsCheck(...args)
  }
})

describe('contractDoneWhen', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-cdw-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    externalDiagnosticsCheck.mockReset()
  })

  afterEach(() => {
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
  })

  it('parses Done when bullets and skips other sections', () => {
    const bullets = parseDoneWhenBullets(`## Goal

Ship it

## Done when

- File \`src/foo.ts\` exists
- Typecheck is clean
- The goal is satisfied

## Notes

- ignore me
`)
    expect(bullets).toEqual([
      'File `src/foo.ts` exists',
      'Typecheck is clean',
      'The goal is satisfied'
    ])
  })

  it('extracts file_exists and typecheck criteria; skips subjective bullets', () => {
    const criteria = parseCheckableCriteria([
      'The goal above is satisfied (check outcomes).',
      'Create `src/a.ts` and wire it up',
      'Ensure typecheck passes with no type errors',
      'Also add tests/main/unit/foo.test.ts',
      'Or blockers are explained clearly'
    ])
    expect(criteria.some((c) => c.kind === 'typecheck_clean')).toBe(true)
    expect(criteria.filter((c) => c.kind === 'file_exists').map((c) => c.kind === 'file_exists' && c.path)).toEqual(
      expect.arrayContaining(['src/a.ts', 'tests/main/unit/foo.test.ts'])
    )
    expect(criteria.filter((c) => c.kind === 'typecheck_clean')).toHaveLength(1)
  })

  it('evaluates missing vs existing files', async () => {
    writeFileSync(join(workspace, 'present.ts'), 'export {}\n')
    const criteria = parseCheckableCriteria([
      'Need `present.ts`',
      'Need `missing.ts`'
    ])
    const results = await evaluateContractCriteria(
      workspace,
      criteria,
      new AbortController().signal
    )
    expect(results.find((r) => r.criterion.kind === 'file_exists' && r.criterion.path === 'present.ts')?.met).toBe(
      true
    )
    expect(results.find((r) => r.criterion.kind === 'file_exists' && r.criterion.path === 'missing.ts')?.met).toBe(
      false
    )
  })

  it('dedupes typecheck and uses externalDiagnosticsCheck once', async () => {
    externalDiagnosticsCheck.mockResolvedValue({ clean: false, excerpt: 'dirty' })
    const criteria = parseCheckableCriteria([
      'Run diagnostics',
      'Typecheck must be clean'
    ])
    expect(criteria).toHaveLength(1)
    const results = await evaluateContractCriteria(
      workspace,
      criteria,
      new AbortController().signal
    )
    expect(externalDiagnosticsCheck).toHaveBeenCalledTimes(1)
    expect(results[0]?.met).toBe(false)
  })

  it('shouldNudgeContractDoneWhen mirrors notice/require semantics', () => {
    const criteria = parseCheckableCriteria(['Need `gone.ts`'])
    const results = [
      {
        criterion: criteria[0]!,
        met: false,
        detail: 'Missing file: gone.ts'
      }
    ]
    expect(
      shouldNudgeContractDoneWhen({
        mode: 'require',
        agentMode: 'agent',
        criteria,
        results,
        alreadyNudged: true,
        incomplete: undefined
      })
    ).toBe(true)
    expect(
      shouldNudgeContractDoneWhen({
        mode: 'notice',
        agentMode: 'agent',
        criteria,
        results,
        alreadyNudged: true,
        incomplete: undefined
      })
    ).toBe(false)
    expect(
      shouldNudgeContractDoneWhen({
        mode: 'require',
        agentMode: 'agent',
        criteria: [],
        results: [],
        alreadyNudged: false,
        incomplete: undefined
      })
    ).toBe(false)
    expect(
      shouldNudgeContractDoneWhen({
        mode: 'off',
        agentMode: 'agent',
        criteria,
        results,
        alreadyNudged: false,
        incomplete: undefined
      })
    ).toBe(false)
  })

  it('builds nudge message and unmet summaries', () => {
    const criteria = parseCheckableCriteria(['Need `x.ts`'])
    const failures = [
      {
        criterion: criteria[0]!,
        met: false,
        detail: 'Missing file: x.ts'
      }
    ]
    expect(contractDoneWhenNudgeMessage('require', failures)).toMatch(/require/i)
    expect(contractDoneWhenNudgeMessage('require', failures)).toMatch(/x\.ts/)
    expect(unmetCriteriaSummaries(failures)).toEqual(['file_exists:x.ts'])
  })
})
