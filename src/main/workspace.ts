import { dialog, BrowserWindow, shell, app } from 'electron'
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { assertInsideWorkspace } from '../shared/workspacePath'
import { setSettings } from './settings'

export { assertInsideWorkspace }

export function getDefaultHarnessPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'harness', 'default.md')
  }
  return join(app.getAppPath(), 'resources', 'harness', 'default.md')
}

export function ensureWorkspaceVyotiq(workspaceRoot: string): void {
  const dir = join(workspaceRoot, '.vyotiq')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const harness = join(dir, 'harness.md')
  if (!existsSync(harness)) {
    const src = getDefaultHarnessPath()
    if (existsSync(src)) copyFileSync(src, harness)
  }
  const runs = join(dir, 'runs')
  if (!existsSync(runs)) mkdirSync(runs, { recursive: true })
}

export async function pickWorkspace(win: BrowserWindow | null): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory']
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return null
  const root = result.filePaths[0]
  ensureWorkspaceVyotiq(root)
  setSettings({ workspacePath: root })
  return root
}

export async function openHarness(workspaceRoot: string): Promise<void> {
  if (!workspaceRoot.trim()) {
    throw new Error('Workspace path is required')
  }
  if (!existsSync(workspaceRoot)) {
    throw new Error(`Workspace not found: ${workspaceRoot}`)
  }
  ensureWorkspaceVyotiq(workspaceRoot)
  const harness = join(workspaceRoot, '.vyotiq', 'harness.md')
  const err = await shell.openPath(harness)
  if (err) {
    throw new Error(err)
  }
}

export function readHarness(workspaceRoot: string): string {
  ensureWorkspaceVyotiq(workspaceRoot)
  const harness = join(workspaceRoot, '.vyotiq', 'harness.md')
  if (existsSync(harness)) return readFileSync(harness, 'utf8')
  const fallback = getDefaultHarnessPath()
  if (existsSync(fallback)) return readFileSync(fallback, 'utf8')
  return 'You are a helpful coding agent.'
}
