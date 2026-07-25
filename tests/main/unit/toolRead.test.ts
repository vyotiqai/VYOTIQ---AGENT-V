import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { toolRead } from '@main/agent/tools/read'

describe('toolRead', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'vyotiq-read-'))
    mkdirSync(join(root, 'subdir'), { recursive: true })
    writeFileSync(join(root, 'hello.txt'), 'hello world', 'utf8')
    writeFileSync(join(root, 'subdir', 'nested.txt'), 'nested', 'utf8')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reads a small file', () => {
    expect(toolRead(root, 'hello.txt')).toBe('hello world')
  })

  it('lists directory contents instead of throwing not-a-file', () => {
    const out = toolRead(root, 'subdir')
    expect(out).toContain('Path is a directory')
    expect(out).toContain('nested.txt')
  })

  it('suggests similar names when file is missing', () => {
    try {
      toolRead(root, 'hell.txt')
      expect.fail('expected throw')
    } catch (err) {
      expect(String(err)).toContain('File not found')
      expect(String(err)).toContain('hello.txt')
    }
  })

  it('supports offset/limit for partial reads', () => {
    const out = toolRead(root, 'hello.txt', { offset: 6, limit: 5 })
    expect(out).toContain('world')
  })
})
