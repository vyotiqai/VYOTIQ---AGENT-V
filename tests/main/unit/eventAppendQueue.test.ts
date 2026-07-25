import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  enqueueEventAppend,
  flushEventAppends,
  resetEventAppendQueueForTests
} from '@main/agent/eventAppendQueue'

describe('eventAppendQueue', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vyotiq-event-append-'))
    mkdirSync(dir, { recursive: true })
    resetEventAppendQueueForTests()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    resetEventAppendQueueForTests()
  })

  it('appends events asynchronously in order', async () => {
    const path = join(dir, 'events.jsonl')
    enqueueEventAppend(dir, { type: 'status', status: 'running' })
    enqueueEventAppend(dir, { type: 'status', status: 'done' })
    await flushEventAppends(dir)

    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).event).toMatchObject({ type: 'status', status: 'running' })
    expect(JSON.parse(lines[1]!).event).toMatchObject({ type: 'status', status: 'done' })
  })
})
