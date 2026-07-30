import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  enqueueStatusPatch,
  flushStatusWrites,
  resetStatusWriteQueueForTests
} from '@main/agent/statusWriteQueue'

describe('statusWriteQueue', () => {
  let dir: string

  beforeEach(() => {
    resetStatusWriteQueueForTests()
    dir = mkdtempSync(join(tmpdir(), 'vyotiq-status-'))
    writeFileSync(
      join(dir, 'status.json'),
      JSON.stringify({ status: 'running', step: 0, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    )
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetStatusWriteQueueForTests()
    vi.useRealTimers()
  })

  it('coalesces step ticks and flushes after debounce', async () => {
    enqueueStatusPatch(dir, { step: 1, status: 'running' })
    enqueueStatusPatch(dir, { step: 2, status: 'running' })
    enqueueStatusPatch(dir, { step: 3, status: 'running' })

    const before = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as { step: number }
    expect(before.step).toBe(0)

    await vi.advanceTimersByTimeAsync(250)
    await flushStatusWrites(dir)

    const after = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as { step: number }
    expect(after.step).toBe(3)
  })

  it('flushes terminal status immediately', async () => {
    enqueueStatusPatch(dir, { step: 1, status: 'running' })
    enqueueStatusPatch(dir, { status: 'done' })

    await flushStatusWrites(dir)

    const after = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as {
      step: number
      status: string
    }
    expect(after.status).toBe('done')
    expect(after.step).toBe(1)
    expect(existsSync(join(dir, 'status.json'))).toBe(true)
  })
})
