/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MarketplaceView } from '@renderer/features/marketplace'
import type { Settings } from '@shared/ipc'
import { DEFAULT_SETTINGS } from '@shared/ipc'

afterEach(() => {
  cleanup()
})

const baseSettings: Settings = {
  ...DEFAULT_SETTINGS,
  marketplace: { registryUrl: '', remoteInstallAcked: true },
  mcpServers: []
}

const catalogPackages = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    version: '1.0.0',
    description: 'MCP filesystem',
    kind: 'mcp' as const,
    source: 'bundled' as const,
    sections: ['discover', 'featured'] as const,
    category: 'infrastructure',
    featuredRank: 1,
    verified: true,
    publisher: 'Model Context Protocol',
    installable: true,
    bundledPath: 'filesystem'
  },
  {
    id: 'memory',
    name: 'Memory',
    version: '1.0.0',
    description: 'MCP memory',
    kind: 'mcp' as const,
    source: 'bundled' as const,
    sections: ['discover', 'featured'] as const,
    category: 'infrastructure',
    featuredRank: 2,
    verified: true,
    publisher: 'Model Context Protocol',
    installable: true,
    bundledPath: 'memory'
  },
  {
    id: 'docs',
    name: 'Docs',
    version: '1.0.0',
    description: 'Docs skill',
    kind: 'skill' as const,
    source: 'bundled' as const,
    sections: ['featured'] as const,
    category: 'skills',
    featuredRank: 3,
    verified: true,
    publisher: 'Vyotiq',
    installable: true,
    bundledPath: 'docs'
  }
]

describe('MarketplaceView', () => {
  beforeEach(() => {
    // @ts-expect-error test bridge
    window.vyotiq = {
      marketplaceBrowse: vi.fn(async (opts?: { q?: string; kind?: string }) => {
        const q = opts?.q?.trim().toLowerCase()
        let packages = catalogPackages
        if (opts?.kind) packages = packages.filter((p) => p.kind === opts.kind)
        if (q) {
          packages = packages.filter(
            (p) =>
              p.id.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q) ||
              p.description.toLowerCase().includes(q)
          )
        }
        return { ok: true as const, data: { packages } }
      }),
      marketplaceListInstalled: vi.fn(async () => ({
        ok: true as const,
        data: {
          schemaVersion: 1 as const,
          items: [
            {
              id: 'memory',
              kind: 'mcp' as const,
              name: 'Memory',
              version: '1.0.0',
              description: '',
              enabled: true,
              installSource: 'bundled' as const,
              installedAt: new Date().toISOString(),
              packagePath: 'memory/1.0.0'
            }
          ]
        }
      })),
      marketplaceGetContents: vi.fn(async () => ({
        ok: true as const,
        data: {
          id: 'filesystem',
          kind: 'mcp' as const,
          mcp: [{ id: 'filesystem', name: 'Filesystem', path: 'vyotiq.mcp.json' }],
          skills: [],
          rules: []
        }
      })),
      marketplaceInstall: vi.fn(async () => ({
        ok: true as const,
        data: {
          item: {
            id: 'filesystem',
            kind: 'mcp' as const,
            name: 'Filesystem',
            version: '1.0.0',
            description: '',
            enabled: true,
            installSource: 'bundled' as const,
            installedAt: new Date().toISOString(),
            packagePath: 'filesystem/1.0.0'
          }
        }
      })),
      mcpStatus: vi.fn(async () => ({
        ok: true as const,
        data: {
          servers: [
            {
              id: 'memory',
              name: 'Memory',
              enabled: true,
              connected: true,
              toolCount: 2
            }
          ]
        }
      })),
      mcpRefresh: vi.fn(async () => ({
        ok: true as const,
        data: {
          servers: [
            {
              id: 'memory',
              name: 'Memory',
              enabled: true,
              connected: true,
              toolCount: 2
            }
          ]
        }
      })),
      marketplaceDetectMcp: vi.fn(async () => ({
        ok: true as const,
        data: {
          kind: 'stdio' as const,
          confidence: 'high' as const,
          server: {
            id: 'mcp-crg',
            name: 'code-review-graph',
            transport: 'stdio' as const,
            command: 'uvx',
            args: ['code-review-graph', 'serve'],
            enabled: true,
            source: 'manual' as const
          },
          warnings: [],
          duplicate: false
        }
      })),
      marketplaceApplyDetectedMcp: vi.fn(async () => ({
        ok: true as const,
        data: { applied: 'manual' as const, serverId: 'mcp-crg' }
      })),
      marketplaceScanExternalMcp: vi.fn(async () => ({
        ok: true as const,
        data: {
          preview: [],
          applied: 0,
          skipped: 0,
          warnings: [],
          scannedPaths: []
        }
      })),
      marketplaceImportExternalMcp: vi.fn(async () => ({
        ok: true as const,
        data: {
          preview: [],
          applied: 0,
          skipped: 0,
          warnings: [],
          scannedPaths: []
        }
      })),
      marketplacePickLocal: vi.fn(async () => ({ ok: true as const, data: null }))
    }
  })

  it('renders Discover and Featured without coming-soon stubs', async () => {
    render(
      <MarketplaceView settings={baseSettings} onUpdate={vi.fn(async () => ({ ok: true as const }))} />
    )
    expect(await screen.findByRole('heading', { name: /^Discover$/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Featured$/i })).toBeTruthy()
    expect(screen.getAllByText('Filesystem').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^Coming soon$/i })).toBeNull()
  })

  it('shows connected state for installed MCP packages', async () => {
    render(
      <MarketplaceView settings={baseSettings} onUpdate={vi.fn(async () => ({ ok: true as const }))} />
    )
    expect(await screen.findAllByText(/Connected · 2 tools/i)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Connected$/i }).length).toBeGreaterThan(0)
  })

  it('marks the selected package when returning from detail', async () => {
    render(
      <MarketplaceView settings={baseSettings} onUpdate={vi.fn(async () => ({ ok: true as const }))} />
    )
    await screen.findByRole('heading', { name: /^Discover$/i })
    fireEvent.click(screen.getAllByText('Filesystem')[0]!)
    expect(await screen.findByRole('button', { name: /^Add to Vyotiq$/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Marketplace$/i }))
    await screen.findByRole('heading', { name: /^Discover$/i })
    const selected = screen.getAllByRole('button', { current: true })
    expect(selected.some((el) => el.textContent?.includes('Filesystem'))).toBe(true)
  })

  it('opens package detail with contents', async () => {
    render(
      <MarketplaceView settings={baseSettings} onUpdate={vi.fn(async () => ({ ok: true as const }))} />
    )
    await screen.findByRole('heading', { name: /^Discover$/i })
    fireEvent.click(screen.getAllByText('Filesystem')[0]!)
    expect(await screen.findByRole('button', { name: /^Add to Vyotiq$/i })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^MCP$/i })).toBeTruthy()
    })
  })

  it('opens Manage from home', async () => {
    render(
      <MarketplaceView settings={baseSettings} onUpdate={vi.fn(async () => ({ ok: true as const }))} />
    )
    await screen.findByRole('button', { name: /^Manage$/i })
    fireEvent.click(screen.getByRole('button', { name: /^Manage$/i }))
    expect(await screen.findByRole('tab', { name: /^Installed$/i })).toBeTruthy()
  })

  it('empty search points to Manage → Add for external MCPs', async () => {
    render(
      <MarketplaceView settings={baseSettings} onUpdate={vi.fn(async () => ({ ok: true as const }))} />
    )
    await screen.findByRole('heading', { name: /^Discover$/i })
    fireEvent.change(screen.getByLabelText(/Search marketplace/i), {
      target: { value: 'not-in-catalog-xyz' }
    })
    expect(
      await screen.findByText(/No matching packages in the curated catalog/i)
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Open Manage to add$/i }))
    expect(await screen.findByRole('tab', { name: /^Installed$/i })).toBeTruthy()
  })

  it('links installed detail to Manage', async () => {
    render(
      <MarketplaceView settings={baseSettings} onUpdate={vi.fn(async () => ({ ok: true as const }))} />
    )
    await screen.findByRole('heading', { name: /^Discover$/i })
    fireEvent.click(screen.getAllByText('Memory')[0]!)
    expect(await screen.findByRole('button', { name: /^Connected$/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Manage$/i }))
    expect(await screen.findByRole('tab', { name: /^Installed$/i })).toBeTruthy()
  })

  it('detects pasted stdio MCP on Manage Add tab', async () => {
    render(
      <MarketplaceView settings={baseSettings} onUpdate={vi.fn(async () => ({ ok: true as const }))} />
    )
    fireEvent.click(await screen.findByRole('button', { name: /^Manage$/i }))
    fireEvent.click(await screen.findByRole('tab', { name: /^Add$/i }))
    const paste = await screen.findByLabelText(/Paste MCP URL, command, or JSON/i)
    fireEvent.change(paste, { target: { value: 'uvx code-review-graph serve' } })
    fireEvent.click(screen.getByRole('button', { name: /^Detect$/i }))
    expect(await screen.findByDisplayValue('uvx')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add & connect/i }))
    await waitFor(() => {
      expect(window.vyotiq.marketplaceApplyDetectedMcp).toHaveBeenCalled()
    })
  })
})
