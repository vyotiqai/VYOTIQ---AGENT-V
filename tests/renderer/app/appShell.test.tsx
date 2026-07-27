/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppShell } from '@renderer/app/AppShell'

const baseProps = {
  view: 'chat' as const,
  workspacePath: '/ws/demo',
  openWorkspaces: ['/ws/demo'],
  activeRuns: [] as { runId: string; workspacePath: string }[],
  runs: [
    {
      runId: 'run-abc',
      goal: 'Fix tests',
      status: 'done' as const,
      updatedAt: new Date().toISOString()
    }
  ],
  activeRunId: null,
  sessionQuery: '',
  onSessionQuery: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenChat: vi.fn(),
  onOpenHarness: vi.fn(),
  onNewChat: vi.fn(),
  onSelectRun: vi.fn(),
  onRenameRun: vi.fn(),
  onDeleteRun: vi.fn(),
  onSwitchWorkspace: vi.fn(),
  onCloseWorkspace: vi.fn(),
  onAddWorkspace: vi.fn(),
  workspaceHasBackgroundRun: () => false
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('1024px'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  })
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value))
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      }
    }
  })
  // @ts-expect-error test bridge
  window.vyotiq = {
    platform: 'win32',
    windowIsMaximized: vi.fn(async () => ({ ok: true as const, data: false }))
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AppShell', () => {
  it('opens and closes the mobile drawer with escape', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        matches: false,
        media: '',
        addEventListener: () => {},
        removeEventListener: () => {}
      })
    })

    render(
      <AppShell {...baseProps}>
        <p>Main content</p>
      </AppShell>
    )

    fireEvent.click(screen.getByRole('button', { name: /open menu/i }))
    expect(screen.getByRole('dialog', { name: /navigation/i })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /navigation/i })).toBeNull()
  })

  it('selects a chat from the sidebar', () => {
    const onSelectRun = vi.fn()
    const onOpenChat = vi.fn()
    render(
      <AppShell {...baseProps} onSelectRun={onSelectRun} onOpenChat={onOpenChat}>
        <p>Main content</p>
      </AppShell>
    )

    fireEvent.click(screen.getAllByRole('button', { name: /fix tests/i })[0])
    expect(onSelectRun).toHaveBeenCalledWith('run-abc')
    expect(onOpenChat).toHaveBeenCalled()
  })

  it('shows agent-first sidebar with chats and workspace controls', () => {
    render(
      <AppShell {...baseProps}>
        <p>Main content</p>
      </AppShell>
    )
    expect(screen.getByRole('region', { name: /chats/i })).toBeTruthy()
    expect(screen.getByRole('tablist', { name: /workspaces/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /settings/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /harness/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /collapse sidebar/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /open menu/i })).toBeNull()
  })

  it('collapses the desktop sidebar to an icon rail', () => {
    render(
      <AppShell {...baseProps}>
        <p>Main content</p>
      </AppShell>
    )

    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /search chats/i })).toBeNull()
    expect(localStorage.getItem('vyotiq.sidebarCollapsed')).toBe('1')

    // Collapsed rail: essentials only
    expect(screen.getByRole('button', { name: /^new chat$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^settings$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^harness$/i })).toBeTruthy()
    expect(screen.getByRole('tablist', { name: /workspaces/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /add workspace/i })).toBeTruthy()
  })

  it('disables workspace-dependent sidebar actions when no workspace is open', () => {
    render(
      <AppShell {...baseProps} workspacePath={null} openWorkspaces={[]} runs={[]}>
        <p>Main content</p>
      </AppShell>
    )

    expect((screen.getByRole('button', { name: /new chat/i }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect((screen.getByRole('textbox', { name: /search chats/i }) as HTMLInputElement).disabled).toBe(
      true
    )
    expect((screen.getByRole('button', { name: /harness/i }) as HTMLButtonElement).disabled).toBe(
      false
    )
    expect((screen.getByRole('button', { name: /settings/i }) as HTMLButtonElement).disabled).toBe(
      false
    )
    expect(screen.getByText('Open a workspace to see chats')).toBeTruthy()
  })

  it('toggles the desktop sidebar with Ctrl/Cmd+B', () => {
    render(
      <AppShell {...baseProps}>
        <p>Main content</p>
      </AppShell>
    )

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(screen.getByRole('button', { name: /collapse sidebar/i })).toBeTruthy()
  })

  it('focuses chat search with Ctrl/Cmd+K after expanding', async () => {
    render(
      <AppShell {...baseProps}>
        <p>Main content</p>
      </AppShell>
    )

    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(screen.queryByRole('textbox', { name: /search chats/i })).toBeNull()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const search = await screen.findByRole('textbox', { name: /search chats/i })
    await waitFor(() => {
      expect(document.activeElement).toBe(search)
    })
  })

  it('keeps the chat list visible when runsError is set', () => {
    render(
      <AppShell {...baseProps} runsError="Failed to load chats">
        <p>Main content</p>
      </AppShell>
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Failed to load chats')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /fix tests/i }).length).toBeGreaterThan(0)
  })
})
