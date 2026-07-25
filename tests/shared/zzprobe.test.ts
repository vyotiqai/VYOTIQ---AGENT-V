import { describe, expect, it } from 'vitest'
import { AppError, toAppError } from '@shared/errors'
import { scrubString, scrubValue } from '@shared/scrub'
import { assertInsideWorkspace, canonicalizeWorkspacePath } from '@shared/workspacePath'
import { workspacePathsEqual } from '@shared/workspacePathMatch'
import { formatElapsed, relativeTime } from '@shared/timeFormat'
import { summarizeToolArgs, mcpToolSummary } from '@shared/toolSummary'
import { applyEventTimestamps, messagesToUiItems } from '@shared/transcript'
import { logger, setLoggerBackend } from '@shared/logger'

function show(label: string, value: unknown): void {
  console.log(`PROBE ${label}:`, JSON.stringify(value))
}

describe('probe', () => {
  it('errors', () => {
    const src = new AppError('boom', {
      code: 'PROVIDER_RATE',
      severity: 'fatal',
      retriable: true,
      context: { a: 1 }
    })
    const out = toAppError(src, { correlationId: 'cid1' })
    show('toAppError.severity', out.severity)
    show('toAppError.retriable', out.retriable)
    show('toAppError.code', out.code)
    show('toAppError.context', out.context)
    expect(true).toBe(true)
  })

  it('scrub', () => {
    show('url token', scrubString('GET https://api.x.com/v1?access_token=ya29.AbCdEfGhIjKl&x=1'))
    show('url apikey', scrubString('https://api.x.com/v1?api_key=abcdef123456'))
    show('bare token', scrubString('token=abcdef1234567890'))
    show('AccessToken key', scrubValue({ AccessToken: 'abc', Api_Key: 'z', SESSION_TOKEN: 'q' }))
    const cyc: Record<string, unknown> = { a: 1 }
    cyc.self = cyc
    show('cyclic', scrubValue(cyc))
    const arr: unknown[] = []
    arr.push(arr)
    show('cyclic array', scrubValue(arr))
    show('err in array', scrubValue([new Error('sk-abcdefghijklmnop')]))
    expect(true).toBe(true)
  })

  it('paths', () => {
    show('canon C:', canonicalizeWorkspacePath('C:'))
    show('canon trailing', canonicalizeWorkspacePath('C:\\proj\\'))
    show('canon unc', canonicalizeWorkspacePath('\\\\srv\\share\\a\\..\\b'))
    show('canon dotdot beyond root', canonicalizeWorkspacePath('C:\\a\\..\\..\\..\\b'))
    show('equal drive case', workspacePathsEqual('C:\\proj', 'c:/proj/'))
    show('equal posix case', workspacePathsEqual('/home/u/p', '/home/u/P'))
    show('equal mixed', workspacePathsEqual('C:\\proj', 'C:\\proj\\..\\proj'))
    const root = 'C:\\Users\\admin\\proj'
    for (const rel of ['a.ts', '..\\projevil\\a', 'sub/../../projevil', '/etc/passwd', 'C:\\other', '\\\\srv\\s', '..', '.', '']) {
      let res: string
      try {
        res = assertInsideWorkspace(root, rel)
      } catch (e) {
        res = `THROW ${(e as Error).message}`
      }
      show(`assertInside ${JSON.stringify(rel)}`, res)
    }
    let r2: string
    try {
      r2 = assertInsideWorkspace('/home/u/proj', '../projevil')
    } catch (e) {
      r2 = `THROW ${(e as Error).message}`
    }
    show('assertInside posix escape', r2)
    let r3: string
    try {
      r3 = assertInsideWorkspace('C:\\proj', 'C:\\proj2')
    } catch (e) {
      r3 = `THROW ${(e as Error).message}`
    }
    show('assertInside sibling prefix', r3)
    expect(true).toBe(true)
  })

  it('time', () => {
    show('elapsed NaN', formatElapsed(NaN))
    show('elapsed 999.4', formatElapsed(999.4))
    show('elapsed -5', formatElapsed(-5))
    show('elapsed 59500', formatElapsed(59500))
    show('elapsed 60000', formatElapsed(60000))
    show('relative future', relativeTime(new Date(Date.now() + 1500).toISOString()))
    show('relative invalid', relativeTime('nope'))
    show('relative 47h', relativeTime(new Date(Date.now() - 47 * 3600_000).toISOString()))
    expect(true).toBe(true)
  })

  it('toolSummary', () => {
    show('memory_list', summarizeToolArgs('memory_list', '{}'))
    show('empty args', summarizeToolArgs('read', ''))
    show('todo_write', summarizeToolArgs('todo_write', '{"todos":[]}'))
    show('unknown tool', summarizeToolArgs('foo', '{"bar":1}'))
    show('mcp read', mcpToolSummary('read_file', { path: '/a/b.ts' }))
    show('mcp query', mcpToolSummary('lookup', { query: 'zzz' }))
    show('edit no path', summarizeToolArgs('edit', '{"contents":"x"}'))
    expect(true).toBe(true)
  })

  it('transcript NaN timing', () => {
    const items = messagesToUiItems([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'c1', toolName: 'read', content: 'ok' }
    ])
    const enriched = applyEventTimestamps(items, [
      { at: 'garbage', event: { type: 'tool_start', runId: 'r', toolCallId: 'c1', name: 'read', summary: 's' } }
    ])
    const t = enriched.find((i) => i.kind === 'tool')
    show('groupTiming', t?.kind === 'tool' ? t.groupTiming : null)
    expect(true).toBe(true)
  })

  it('logger merge', () => {
    const calls: unknown[] = []
    setLoggerBackend({ log: (l, m, f) => calls.push([l, m, f]) })
    logger.exception(new AppError('x', { code: 'TOOL_EXEC', severity: 'fatal' }), { scope: 'a' })
    show('exception fields', calls)
    expect(true).toBe(true)
  })
})
