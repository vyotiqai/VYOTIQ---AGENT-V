import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  enqueueMessageAppend,
  flushMessageAppends,
  messageAppendChainSizeForTests,
  resetMessageAppendQueueForTests
} from '@main/agent/messageAppendQueue'

describe('messageAppendQueue', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vyotiq-msg-append-'))
    mkdirSync(dir, { recursive: true })
    resetMessageAppendQueueForTests()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    resetMessageAppendQueueForTests()
  })

  it('appends messages asynchronously in order and prunes settled chains', async () => {
    const path = join(dir, 'messages.jsonl')
    enqueueMessageAppend(dir, `${JSON.stringify({ role: 'user', content: 'a' })}\n`)
    enqueueMessageAppend(dir, `${JSON.stringify({ role: 'assistant', content: 'b' })}\n`)
    expect(messageAppendChainSizeForTests()).toBeGreaterThanOrEqual(1)
    await flushMessageAppends(dir)

    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).content).toBe('a')
    expect(JSON.parse(lines[1]!).content).toBe('b')
    expect(messageAppendChainSizeForTests()).toBe(0)
  })
})
