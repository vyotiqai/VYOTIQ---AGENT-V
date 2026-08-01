import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULT_SETTINGS } from '@shared/ipc'

vi.mock('@main/settings/settings', () => ({
  getSettings: () => ({
    ...DEFAULT_SETTINGS,
    diagnosticsCommand: 'node -e "console.log(\'src/a.ts:1:1: error boom\')"'
  })
}))

const commitAll = vi.fn(async () => ({
  committed: true,
  pushed: false,
  detail: 'Committed 1 file'
}))

vi.mock('@main/git/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/git/git')>()
  return {
    ...actual,
    commitAll: (...args: unknown[]) => commitAll(...args)
  }
})

const manageTabs = vi.fn(async () => '  tab-1  Home  https://example.com/')
const navigateUrl = vi.fn(async () => 'navigated: https://example.com/')
const snapshotPage = vi.fn(async () => 'refs:\n@e1 button Submit')
const clickSelector = vi.fn(async () => 'clicked @e1')

vi.mock('@main/app/agentBrowser', () => ({
  manageTabs: (...args: unknown[]) => manageTabs(...args),
  navigateUrl: (...args: unknown[]) => navigateUrl(...args),
  snapshotPage: (...args: unknown[]) => snapshotPage(...args),
  clickSelector: (...args: unknown[]) => clickSelector(...args)
}))

const toolWebFetch = vi.fn(async () => '# Fetched page')
const toolWebSearch = vi.fn(async () => '1. Example\nhttps://example.com/')

vi.mock('@main/agent/tools/webFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/tools/webFetch')>()
  return {
    ...actual,
    toolWebFetch: (...args: unknown[]) => toolWebFetch(...args)
  }
})

vi.mock('@main/agent/tools/webSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/agent/tools/webSearch')>()
  return {
    ...actual,
    toolWebSearch: (...args: unknown[]) => toolWebSearch(...args)
  }
})

import { executeTool } from '@main/agent/tools'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('executeTool git / diagnostics / browser', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'vyotiq-exec-tools-'))
    manageTabs.mockClear()
    navigateUrl.mockClear()
    snapshotPage.mockClear()
    clickSelector.mockClear()
    commitAll.mockClear()
    toolWebFetch.mockClear()
    toolWebSearch.mockClear()
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

  it('git_commit stages via commitAll', async () => {
    const result = await executeTool(
      'git_commit',
      JSON.stringify({ message: 'feat: test commit' }),
      workspace,
      new AbortController().signal
    )
    expect(result.ok).toBe(true)
    expect(commitAll).toHaveBeenCalledWith(workspace, 'feat: test commit', false)
    expect(result.content).toContain('committed: true')
    expect(result.content).toContain('message: feat: test commit')
  })

  it('git_commit fails without a message', async () => {
    const result = await executeTool(
      'git_commit',
      JSON.stringify({ message: '   ' }),
      workspace,
      new AbortController().signal
    )
    expect(result.ok).toBe(false)
    expect(commitAll).not.toHaveBeenCalled()
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

  it('browser_navigate / snapshot / click route through agentBrowser', async () => {
    const signal = new AbortController().signal
    const nav = await executeTool(
      'browser_navigate',
      JSON.stringify({ url: 'https://example.com/' }),
      workspace,
      signal
    )
    expect(nav.ok).toBe(true)
    expect(navigateUrl).toHaveBeenCalled()

    const snap = await executeTool('browser_snapshot', '{}', workspace, signal)
    expect(snap.ok).toBe(true)
    expect(snapshotPage).toHaveBeenCalled()
    expect(snap.content).toContain('@e1')

    const click = await executeTool(
      'browser_click',
      JSON.stringify({ selector: '@e1' }),
      workspace,
      signal
    )
    expect(click.ok).toBe(true)
    expect(clickSelector).toHaveBeenCalled()
  })

  it('web_fetch and web_search go through executeTool', async () => {
    const signal = new AbortController().signal
    const fetched = await executeTool(
      'web_fetch',
      JSON.stringify({ url: 'https://example.com/' }),
      workspace,
      signal
    )
    expect(fetched.ok).toBe(true)
    expect(toolWebFetch).toHaveBeenCalled()
    expect(fetched.content).toContain('Fetched page')

    const searched = await executeTool(
      'web_search',
      JSON.stringify({ query: 'vyotiq agent' }),
      workspace,
      signal
    )
    expect(searched.ok).toBe(true)
    expect(toolWebSearch).toHaveBeenCalled()
    expect(searched.content).toContain('example.com')
  })
})
