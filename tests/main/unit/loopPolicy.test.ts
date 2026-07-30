import { describe, expect, it } from 'vitest'
import {
  CONSECUTIVE_TOOL_FAILURE_HINT_THRESHOLD,
  CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD,
  applyToolCallToKnownPaths,
  combineLoopHints,
  editPathsFromToolCall,
  isInspectToolName,
  loopHintForConsecutiveFailures,
  loopHintForUnreadEdits,
  maxParallelReadToolsForFailureStreak,
  normalizeWorkspaceRelPath,
  partitionReadBeforeEditCalls,
  readBeforeEditBlockMessage,
  readPathFromToolCall,
  seedKnownPathsFromMessages,
  toolArgsFromCall,
  unreadExistingEditPaths
} from '@main/agent/loopPolicy'

describe('loopPolicy', () => {
  it('does not hint before the threshold', () => {
    expect(loopHintForConsecutiveFailures(CONSECUTIVE_TOOL_FAILURE_HINT_THRESHOLD - 1)).toBeUndefined()
  })

  it('hints at and after the threshold', () => {
    const hint = loopHintForConsecutiveFailures(CONSECUTIVE_TOOL_FAILURE_HINT_THRESHOLD)
    expect(hint).toMatch(/tool failures/i)
    expect(hint).toMatch(/README/)
  })

  it('serializes parallel reads after consecutive failure threshold', () => {
    expect(
      maxParallelReadToolsForFailureStreak(CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD - 1, 4)
    ).toBe(4)
    expect(
      maxParallelReadToolsForFailureStreak(CONSECUTIVE_TOOL_FAILURE_SERIAL_THRESHOLD, 4)
    ).toBe(1)
  })

  it('normalizes workspace-relative paths', () => {
    expect(normalizeWorkspaceRelPath('  src\\foo.ts  ')).toBe('src/foo.ts')
  })

  it('extracts read and edit paths from tool calls', () => {
    expect(readPathFromToolCall('read', { path: 'a\\b.ts' })).toBe('a/b.ts')
    expect(readPathFromToolCall('grep', { path: 'a.ts' })).toBeNull()
    expect(editPathsFromToolCall('str_replace', { path: 'x.ts' })).toEqual(['x.ts'])
    expect(
      editPathsFromToolCall('multi_edit', {
        edits: [{ path: 'a.ts' }, { path: 'b\\c.ts' }, { path: 1 }]
      })
    ).toEqual(['a.ts', 'b/c.ts'])
  })

  it('treats concrete grep include and glob pattern as inspect paths', () => {
    const known = new Set<string>()
    applyToolCallToKnownPaths(known, 'grep', { pattern: 'foo', include: 'src/a.ts' }, true)
    expect(known.has('src/a.ts')).toBe(true)
    applyToolCallToKnownPaths(known, 'glob', { pattern: 'src/**/*.ts' }, true)
    expect(known.has('src/**/*.ts')).toBe(false)
    applyToolCallToKnownPaths(known, 'glob', { pattern: 'src/b.ts' }, true)
    expect(known.has('src/b.ts')).toBe(true)
  })
  it('tracks known paths only on successful read/write', () => {
    const known = new Set<string>()
    applyToolCallToKnownPaths(known, 'read', { path: 'a.ts' }, false)
    expect(known.size).toBe(0)
    applyToolCallToKnownPaths(known, 'read', { path: 'a.ts' }, true)
    expect(known.has('a.ts')).toBe(true)
    applyToolCallToKnownPaths(known, 'edit', { path: 'b.ts' }, true)
    expect(known.has('b.ts')).toBe(true)
  })

  it('nags only for existing unread edit paths', () => {
    const known = new Set(['seen.ts'])
    const exists = (p: string) => p === 'exists.ts' || p === 'seen.ts'
    expect(
      unreadExistingEditPaths(known, 'str_replace', { path: 'exists.ts' }, exists)
    ).toEqual(['exists.ts'])
    expect(
      unreadExistingEditPaths(known, 'str_replace', { path: 'seen.ts' }, exists)
    ).toEqual([])
    expect(
      unreadExistingEditPaths(known, 'edit', { path: 'brand-new.ts' }, exists)
    ).toEqual([])
    expect(unreadExistingEditPaths(known, 'read', { path: 'exists.ts' }, exists)).toEqual([])
  })

  it('builds an unread-edit run notice and combines with other hints', () => {
    expect(loopHintForUnreadEdits([])).toBeUndefined()
    const hint = loopHintForUnreadEdits(['a.ts', 'b.ts'])
    expect(hint).toMatch(/without a prior read/i)
    expect(hint).toMatch(/a\.ts/)
    expect(hint).toMatch(/does not block/i)
    const combined = combineLoopHints(hint, loopHintForConsecutiveFailures(3))
    expect(combined).toMatch(/without a prior read/i)
    expect(combined).toMatch(/tool failures/i)
  })

  it('seeds known paths from assistant toolCalls on resume', () => {
    const known = seedKnownPathsFromMessages([
      {
        role: 'assistant',
        toolCalls: [
          { name: 'read', arguments: '{"path":"src/a.ts"}' },
          { name: 'str_replace', arguments: '{"path":"src\\\\b.ts","old_string":"x","new_string":"y"}' }
        ]
      }
    ])
    expect(known.has('src/a.ts')).toBe(true)
    expect(known.has('src/b.ts')).toBe(true)
  })

  it('partitions require-mode unread edits; same-step read/grep/glob allows edit', () => {
    const exists = (p: string) => p === 'src/a.ts'
    const blockedOnly = partitionReadBeforeEditCalls({
      known: new Set(),
      calls: [{ id: '1', name: 'edit', arguments: '{"path":"src/a.ts","content":"x"}' }],
      pathExists: exists
    })
    expect(blockedOnly.blocked).toHaveLength(1)
    expect(blockedOnly.allowed).toHaveLength(0)
    expect(readBeforeEditBlockMessage(blockedOnly.blocked[0]!.paths)).toMatch(/require/i)

    const sameStepRead = partitionReadBeforeEditCalls({
      known: new Set(),
      calls: [
        { id: '1', name: 'edit', arguments: '{"path":"src/a.ts","content":"x"}' },
        { id: '2', name: 'read', arguments: '{"path":"src/a.ts"}' }
      ],
      pathExists: exists
    })
    expect(sameStepRead.blocked).toHaveLength(0)
    expect(sameStepRead.allowed).toHaveLength(2)

    const sameStepGrep = partitionReadBeforeEditCalls({
      known: new Set(),
      calls: [
        { id: '1', name: 'edit', arguments: '{"path":"src/a.ts","content":"x"}' },
        { id: '2', name: 'grep', arguments: '{"pattern":"foo","include":"src/a.ts"}' }
      ],
      pathExists: exists
    })
    expect(sameStepGrep.blocked).toHaveLength(0)
    expect(sameStepGrep.allowed).toHaveLength(2)

    // Hallucinated grep `path` (not in schema) must not unlock edits.
    const hallucinatedPath = partitionReadBeforeEditCalls({
      known: new Set(),
      calls: [
        { id: '1', name: 'edit', arguments: '{"path":"src/a.ts","content":"x"}' },
        { id: '2', name: 'grep', arguments: '{"pattern":"foo","path":"src/a.ts"}' }
      ],
      pathExists: exists
    })
    expect(hallucinatedPath.blocked).toHaveLength(1)
    expect(hallucinatedPath.allowed).toHaveLength(1)
  })

  it('treats same-step concrete grep as inspect for notice-mode unread hints', () => {
    const known = new Set<string>()
    const exists = (p: string) => p === 'src/a.ts'
    const calls = [
      { id: '1', name: 'grep' as const, arguments: '{"pattern":"x","include":"src/a.ts"}' },
      { id: '2', name: 'edit' as const, arguments: '{"path":"src/a.ts","content":"y"}' }
    ]
    for (const call of calls) {
      if (isInspectToolName(call.name)) {
        applyToolCallToKnownPaths(known, call.name, toolArgsFromCall(call.arguments), true)
      }
    }
    const unread: string[] = []
    for (const call of calls) {
      unread.push(
        ...unreadExistingEditPaths(known, call.name, toolArgsFromCall(call.arguments), exists)
      )
      if (!isInspectToolName(call.name)) {
        applyToolCallToKnownPaths(known, call.name, toolArgsFromCall(call.arguments), true)
      }
    }
    expect(unread).toHaveLength(0)
    expect(loopHintForUnreadEdits(unread)).toBeUndefined()
  })
})
