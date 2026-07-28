import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type {
  MarketplaceOverrides,
  McpServer,
  MarketplaceInstalledItem
} from '../../shared/ipc'
import { VyotiqMcpManifestSchema, VyotiqPluginManifestSchema } from '../../shared/ipc'
import { effectiveMarketplaceEnabled } from '../../shared/domain/marketplaceEnablement'
import { getSettings } from '../settings/settings'
import { readMarketplaceIndex } from './indexStore'
import { marketplacePackagesRoot } from './paths'
import { mcpServerFromManifest } from './install'

function packageRoot(item: MarketplaceInstalledItem): string {
  return join(marketplacePackagesRoot(), item.packagePath)
}

/**
 * Build the MCP server list: manual settings entries + marketplace MCP packages +
 * MCP nested in enabled plugins. When `marketplaceOverrides` is set, it applies
 * to marketplace-sourced servers (standalone + plugin-nested) and to manual
 * entries (Marketplace is the sole MCP management UI).
 *
 * Callers that manage the global session map must pass no overrides so a
 * workspace Force-off cannot disconnect MCP for other workspaces. Per-run tool
 * filtering should call this again with that workspace's overrides.
 */
export function resolveEffectiveMcpServers(
  marketplaceOverrides?: MarketplaceOverrides | null
): McpServer[] {
  const settings = getSettings()
  const index = readMarketplaceIndex()
  const byId = new Map<string, McpServer>()

  // Manual (non-marketplace) entries — still honor per-server workspace mcp overrides
  // now that Marketplace is the sole MCP UI.
  for (const server of settings.mcpServers ?? []) {
    if (server.source === 'marketplace') continue
    const enabled = effectiveMarketplaceEnabled(
      server.id,
      server.enabled,
      marketplaceOverrides,
      'mcp'
    )
    byId.set(server.id, { ...server, enabled })
  }

  // Standalone marketplace MCP packages (overwrite same id as manual — install
  // must reject that collision; see installMarketplacePackage)
  for (const item of index.items) {
    if (item.kind !== 'mcp') continue
    const root = packageRoot(item)
    if (!existsSync(join(root, 'vyotiq.mcp.json'))) continue
    try {
      const server = mcpServerFromManifest(root)
      if (byId.has(server.id) && byId.get(server.id)?.source !== 'marketplace') {
        // Keep the manual entry; marketplace package is shadowed until uninstall
        continue
      }
      const enabled = effectiveMarketplaceEnabled(
        item.id,
        item.enabled,
        marketplaceOverrides,
        'mcp'
      )
      const settingsOverlay = (settings.mcpServers ?? []).find(
        (s) => s.id === server.id && s.source === 'marketplace'
      )
      byId.set(server.id, {
        ...server,
        enabled,
        ...(settingsOverlay
          ? {
              ...(settingsOverlay.transport ? { transport: settingsOverlay.transport } : {}),
              ...(settingsOverlay.command !== undefined
                ? { command: settingsOverlay.command }
                : {}),
              ...(settingsOverlay.args ? { args: settingsOverlay.args } : {}),
              ...(settingsOverlay.env ? { env: settingsOverlay.env } : {}),
              ...(settingsOverlay.url !== undefined ? { url: settingsOverlay.url } : {}),
              ...(settingsOverlay.headers ? { headers: settingsOverlay.headers } : {}),
              ...(settingsOverlay.allowedTools?.length
                ? { allowedTools: settingsOverlay.allowedTools }
                : {}),
              ...(settingsOverlay.deniedTools?.length
                ? { deniedTools: settingsOverlay.deniedTools }
                : {})
            }
          : {})
      })
    } catch {
      // skip invalid
    }
  }

  // Plugin-bundled MCP (plugin enable + optional per-nested mcp override)
  for (const item of index.items) {
    if (item.kind !== 'plugin') continue
    const pluginEnabled = effectiveMarketplaceEnabled(
      item.id,
      item.enabled,
      marketplaceOverrides,
      'plugins'
    )
    if (!pluginEnabled) continue
    const root = packageRoot(item)
    const manifestPath = join(root, 'vyotiq.plugin.json')
    if (!existsSync(manifestPath)) continue
    try {
      const plugin = VyotiqPluginManifestSchema.parse(
        JSON.parse(readFileSync(manifestPath, 'utf8'))
      )
      for (const rel of plugin.mcp) {
        const mcpRoot = join(root, rel)
        const mcpManifestPath = join(mcpRoot, 'vyotiq.mcp.json')
        if (!existsSync(mcpManifestPath)) continue
        const nested = VyotiqMcpManifestSchema.parse(
          JSON.parse(readFileSync(mcpManifestPath, 'utf8'))
        )
        const id = `plugin-${plugin.id}-${nested.id}`.replace(/__/g, '-')
        if (id.includes('__')) continue
        const enabled = effectiveMarketplaceEnabled(id, true, marketplaceOverrides, 'mcp')
        const settingsOverlay = (settings.mcpServers ?? []).find((s) => s.id === id)
        byId.set(id, {
          id,
          name: `${plugin.name}: ${nested.name}`,
          transport: nested.transport,
          command: nested.command,
          args: nested.args,
          env: nested.env,
          url: nested.url,
          headers: nested.headers,
          ...(nested.allowedTools?.length ? { allowedTools: nested.allowedTools } : {}),
          ...(nested.deniedTools?.length ? { deniedTools: nested.deniedTools } : {}),
          ...(settingsOverlay?.allowedTools?.length
            ? { allowedTools: settingsOverlay.allowedTools }
            : {}),
          ...(settingsOverlay?.deniedTools?.length
            ? { deniedTools: settingsOverlay.deniedTools }
            : {}),
          enabled,
          source: 'marketplace',
          packageId: item.id,
          packageVersion: item.version
        })
      }
    } catch {
      // skip invalid plugin
    }
  }

  return [...byId.values()]
}

/** Standalone skill packages that are effectively enabled (not plugin containers). */
export function listEffectivelyEnabledSkills(
  marketplaceOverrides?: MarketplaceOverrides | null
): MarketplaceInstalledItem[] {
  const index = readMarketplaceIndex()
  const out: MarketplaceInstalledItem[] = []
  for (const item of index.items) {
    if (item.kind !== 'skill') continue
    if (effectiveMarketplaceEnabled(item.id, item.enabled, marketplaceOverrides, 'skills')) {
      out.push(item)
    }
  }
  return out
}
