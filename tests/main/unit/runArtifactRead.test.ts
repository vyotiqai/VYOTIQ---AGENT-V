import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveRunDir } from '@main/storage/paths'
import { RunArtifactNameSchema } from '@shared/ipc'

const userData = join(tmpdir(), `vyotiq-artifact-read-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userData
      throw new Error(`unexpected getPath(${name})`)
    },
    getAppPath: () => '/tmp/vyotiq-app',
    isPackaged: false
  }
}))

describe('run artifact files', () => {
  let workspace: string

  beforeEach(() => {
    workspace = join(tmpdir(), `vyotiq-art-ws-${process.pid}-${Date.now()}`)
    mkdirSync(workspace, { recursive: true })
    mkdirSync(userData, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true })
    if (existsSync(userData)) rmSync(userData, { recursive: true, force: true })
  })

  it('can read all four RunArtifactNameSchema files from a run dir', () => {
    const runDir = resolveRunDir(workspace, 'run-artifacts')
    mkdirSync(join(runDir, 'browser'), { recursive: true })
    writeFileSync(join(runDir, 'plan.md'), '# Plan\n', 'utf8')
    writeFileSync(join(runDir, 'contract.md'), '## Goal\n', 'utf8')
    writeFileSync(join(runDir, 'receipt.json'), '{"version":2}\n', 'utf8')
    writeFileSync(join(runDir, 'browser', 'snapshot.jpg'), Buffer.from([0xff, 0xd8, 0xff]))

    for (const name of RunArtifactNameSchema.options) {
      const filePath = join(runDir, name)
      expect(existsSync(filePath)).toBe(true)
      expect(readFileSync(filePath).byteLength).toBeGreaterThan(0)
    }
  })
})
