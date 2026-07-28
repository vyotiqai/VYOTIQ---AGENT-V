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

describe('MarketplaceView', () => {
  beforeEach(() => {
    // @ts-expect-error test bridge
    window.vyotiq = {
      marketplaceBrowse: vi.fn(async () => ({
        ok: true as const,
        data: {
          packages: [
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
              publisher: 'Vyotiq',
              installable: true,
              bundledPath: 'filesystem'
            },
            {
              id: 'terminal',
              name: 'Terminal',
              version: '0.1.0',
              description: 'Coming soon MCP',
              kind: 'mcp' as const,
              source: 'bundled' as const,
              sections: ['featured'] as const,
              category: 'infrastructure',
              featuredRank: 2,
              installable: false
            }
          ]
        }
      })),
      marketplaceListInstalled: vi.fn(async () => ({
        ok: true as const,
        data: { schemaVersion: 1 as const, items: [] }
      })),
      marketplaceGetContents: vi.fn(async () => ({
        ok: true as const,
        data: {
          id: 'filesystem',
          kind: 'mcp' as const,
          mcp: [{ id: 'fs', name: 'Filesystem', path: 'vyotiq.mcp.json' }],
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
      mcpStatus: vi.fn(async () => ({ ok: true as const, data: { servers: [] } })),
      mcpRefresh: vi.fn(async () => ({ ok: true as const, data: { servers: [] } }))
    }
  })

  it('renders Discover and Featured sections', async () => {
    render(
      <MarketplaceView settings={baseSettings} onUpdate={vi.fn(async () => ({ ok: true as const }))} />
    )
    expect(await screen.findByRole('heading', { name: /^Discover$/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Featured$/i })).toBeTruthy()
    expect(screen.getAllByText('Filesystem').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /^Coming soon$/i })).toBeTruthy()
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
})
