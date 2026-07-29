import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  beginWriteCheckpoint,
  discardWriteCheckpoint,
  finalizeWriteCheckpoint,
  getWriteCheckpoint,
  resetWriteCheckpointsForTests,
  undoWrites,
  resolveWrites
} from '@main/agent/checkpoints'
import { executeTool } from '@main/agent/tools'

let workspace: string
let runDir: string

beforeEach(() => {
  resetWriteCheckpointsForTests()
  workspace = mkdtempSync(join(tmpdir(), 'vyotiq-cp-ws-'))
  runDir = mkdtempSync(join(tmpdir(), 'vyotiq-cp-run-'))
  writeFileSync(join(workspace, 'a.txt'), 'hello\n', 'utf8')
})

afterEach(() => {
  resetWriteCheckpointsForTests()
  rmSync(workspace, { recursive: true, force: true })
  rmSync(runDir, { recursive: true, force: true })
})

describe('write checkpoints', () => {
  it('snapshots priors and restores via undo', async () => {
    beginWriteCheckpoint(runDir, workspace)
    const signal = new AbortController().signal
    const result = await executeTool(
      'str_replace',
      JSON.stringify({ path: 'a.txt', old_string: 'hello', new_string: 'world' }),
      workspace,
      signal,
      { runDir }
    )
    expect(result.ok).toBe(true)
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('world\n')

    const meta = finalizeWriteCheckpoint(runDir)
    expect(meta).toBeTruthy()
    expect(meta!.files).toEqual([
      { path: 'a.txt', action: 'modified', undoable: true }
    ])

    const undone = undoWrites(runDir, workspace, meta!.id)
    expect(undone.restored).toEqual(['a.txt'])
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('hello\n')
  })

  it('undoes created files by deleting them', async () => {
    beginWriteCheckpoint(runDir, workspace)
    const signal = new AbortController().signal
    await executeTool(
      'edit',
      JSON.stringify({ path: 'new.txt', contents: 'fresh\n' }),
      workspace,
      signal,
      { runDir }
    )
    const meta = finalizeWriteCheckpoint(runDir)
    expect(meta!.files[0]?.action).toBe('created')
    expect(existsSync(join(workspace, 'new.txt'))).toBe(true)

    undoWrites(runDir, workspace)
    expect(existsSync(join(workspace, 'new.txt'))).toBe(false)
  })

  it('keeps first prior when the same path is written twice', () => {
    const cp = beginWriteCheckpoint(runDir, workspace)
    cp.recordPrior('a.txt', 'write')
    writeFileSync(join(workspace, 'a.txt'), 'mid\n', 'utf8')
    cp.recordPrior('a.txt', 'write')
    writeFileSync(join(workspace, 'a.txt'), 'end\n', 'utf8')
    const meta = finalizeWriteCheckpoint(runDir)
    expect(meta!.files).toHaveLength(1)
    undoWrites(runDir, workspace, meta!.id)
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('hello\n')
  })

  it('marks recursive directory deletes as non-undoable', () => {
    mkdirSync(join(workspace, 'dir'), { recursive: true })
    writeFileSync(join(workspace, 'dir', 'x.txt'), 'x', 'utf8')
    const cp = beginWriteCheckpoint(runDir, workspace)
    cp.recordPrior('dir', 'delete', { recursiveDir: true })
    const meta = cp.finalize()
    discardWriteCheckpoint(runDir)
    expect(meta!.files[0]).toMatchObject({
      path: 'dir',
      action: 'deleted',
      undoable: false
    })
  })

  it('getWriteCheckpoint is empty without begin', () => {
    expect(getWriteCheckpoint(runDir)).toBeUndefined()
  })

  it('discards one path and keeps another', () => {
    writeFileSync(join(workspace, 'b.txt'), 'beta\n', 'utf8')
    const cp = beginWriteCheckpoint(runDir, workspace)
    cp.recordPrior('a.txt', 'write')
    cp.recordPrior('b.txt', 'write')
    writeFileSync(join(workspace, 'a.txt'), 'A\n', 'utf8')
    writeFileSync(join(workspace, 'b.txt'), 'B\n', 'utf8')
    const meta = finalizeWriteCheckpoint(runDir)
    expect(meta!.files).toHaveLength(2)

    const discarded = resolveWrites(runDir, workspace, {
      checkpointId: meta!.id,
      action: 'discard',
      paths: ['a.txt']
    })
    expect(discarded.discarded).toEqual(['a.txt'])
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('hello\n')
    expect(readFileSync(join(workspace, 'b.txt'), 'utf8')).toBe('B\n')

    const kept = resolveWrites(runDir, workspace, {
      checkpointId: meta!.id,
      action: 'keep',
      paths: ['b.txt']
    })
    expect(kept.kept).toEqual(['b.txt'])
    expect(kept.fullyResolved).toBe(true)
    expect(readFileSync(join(workspace, 'b.txt'), 'utf8')).toBe('B\n')
  })

  it('keep all resolves without touching disk', () => {
    const cp = beginWriteCheckpoint(runDir, workspace)
    cp.recordPrior('a.txt', 'write')
    writeFileSync(join(workspace, 'a.txt'), 'changed\n', 'utf8')
    const meta = finalizeWriteCheckpoint(runDir)
    const result = resolveWrites(runDir, workspace, {
      checkpointId: meta!.id,
      action: 'keep'
    })
    expect(result.kept).toEqual(['a.txt'])
    expect(result.fullyResolved).toBe(true)
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('changed\n')
  })

  it('auto-keeps prior unresolved checkpoint when a newer write turn finalizes', () => {
    const first = beginWriteCheckpoint(runDir, workspace)
    first.recordPrior('a.txt', 'write')
    writeFileSync(join(workspace, 'a.txt'), 'turn1\n', 'utf8')
    const meta1 = finalizeWriteCheckpoint(runDir)
    expect(meta1).not.toBeNull()

    writeFileSync(join(workspace, 'b.txt'), 'seed\n', 'utf8')
    const second = beginWriteCheckpoint(runDir, workspace)
    second.recordPrior('b.txt', 'write')
    writeFileSync(join(workspace, 'b.txt'), 'turn2\n', 'utf8')
    const meta2 = finalizeWriteCheckpoint(runDir)
    expect(meta2).not.toBeNull()

    // Prior turn is no longer actionable.
    expect(() =>
      resolveWrites(runDir, workspace, { checkpointId: meta1!.id, action: 'discard' })
    ).toThrow(/already resolved/)
    // Disk from turn 1 remains (auto-keep, not discard).
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('turn1\n')
    // Latest turn still actionable.
    const discarded = resolveWrites(runDir, workspace, {
      checkpointId: meta2!.id,
      action: 'discard',
      paths: ['b.txt']
    })
    expect(discarded.discarded).toEqual(['b.txt'])
    expect(readFileSync(join(workspace, 'b.txt'), 'utf8')).toBe('seed\n')
  })
})
