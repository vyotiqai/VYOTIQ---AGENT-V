import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULT_SETTINGS } from '@shared/ipc'

vi.mock('@main/settings/settings', () => ({
  getSettings: () => ({
    ...DEFAULT_SETTINGS,
    diagnosticsCommand: 'echo src/a.ts:1:1: error boom'
  })
}))

const manageTabs = vi.fn(async () => '  tab-1  Home  https://example.com/')

vi.mock('@main/app/agentBrowser', () => ({
  manageTabs: (...args: unknown[]) => manageTabs(...args)
}))

import { executeTool } from '@main/agent/tools'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('executeTool git / diagnostics / browser', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'vyotiq-exec-tools-'))
    manageTabs.mockClear()
  })

  afterEach(() => {
    if (workspace && existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('git_status returns formatted status for a real repo', async () => {
    git(workspace, 'init', '--initial-branch=main')
    git(workspace, 'config', 'user.email', 'test@example.com')
    git(workspace, 'config', 'user.name', 'Test')
    git(workspace, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(workspace, 'readme.txt'), 'hello\n', 'utf8')
    git(workspace, 'add', '-A')
    git(workspace, 'commit', '-m', 'init')

    const result = await executeTool('git_status', '{}', workspace, new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(result.content).toContain('branch: main')
    expect(result.content).toContain('(clean)')
  })

  it('git_diff reports not-a-repo as ok content', async () => {
    const result = await executeTool('git_diff', '{}', workspace, new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(result.content).toBe('Not a git repository')
  })

  it('git_diff returns unified diff for a dirty tracked file', async () => {
    git(workspace, 'init', '--initial-branch=main')
    git(workspace, 'config', 'user.email', 'test@example.com')
    git(workspace, 'config', 'user.name', 'Test')
    git(workspace, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(workspace, 'kept.txt'), 'one\n', 'utf8')
    git(workspace, 'add', '-A')
    git(workspace, 'commit', '-m', 'init')
    writeFileSync(join(workspace, 'kept.txt'), 'one\ntwo\n', 'utf8')

    const result = await executeTool(
      'git_diff',
      JSON.stringify({ path: 'kept.txt' }),
      workspace,
      new AbortController().signal
    )
    expect(result.ok).toBe(true)
    expect(result.content).toMatch(/\+two|@@/)
  })

  it('diagnostics formats parsed issues for the UI', async () => {
    const result = await executeTool(
      'diagnostics',
      JSON.stringify({ kind: 'typecheck' }),
      workspace,
      new AbortController().signal
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('command:')
    expect(result.content).toMatch(/src\/a\.ts:1:1:\s*error/)
  })

  it('browser_tabs list returns manageTabs content', async () => {
    const result = await executeTool(
      'browser_tabs',
      JSON.stringify({ action: 'list' }),
      workspace,
      new AbortController().signal
    )
    expect(result.ok).toBe(true)
    expect(manageTabs).toHaveBeenCalled()
    expect(result.content).toContain('tab-1')
    expect(result.content).toContain('https://example.com/')
  })
})
