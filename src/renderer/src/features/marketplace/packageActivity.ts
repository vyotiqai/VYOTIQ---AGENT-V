import type {
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
  McpServerStatus
} from '@shared/ipc'

export type PackageActivityKind =
  | 'coming-soon'
  | 'connected'
  | 'enabled'
  | 'disabled'
  | 'installed'
  | 'available'

export type PackageActivity = {
  kind: PackageActivityKind
  /** Short label for card footers / buttons */
  label: string
  /** Optional success/danger tint class for the label */
  className?: string
}

export function packageActivity(
  entry: MarketplaceCatalogEntry,
  installed: MarketplaceInstalledItem | undefined,
  mcpStatus: McpServerStatus | undefined
): PackageActivity {
  if (entry.installable === false) {
    return { kind: 'coming-soon', label: 'Coming soon' }
  }
  if (!installed) {
    return { kind: 'available', label: kindFallback(entry) }
  }
  if (!installed.enabled) {
    return { kind: 'disabled', label: 'Disabled' }
  }
  if (entry.kind === 'mcp') {
    if (mcpStatus?.connected) {
      const n = mcpStatus.toolCount
      return {
        kind: 'connected',
        label: `Connected · ${n} tool${n === 1 ? '' : 's'}`,
        className: 'text-success'
      }
    }
    if (mcpStatus?.error) {
      return { kind: 'enabled', label: 'Enabled · not connected', className: 'text-danger' }
    }
    return { kind: 'enabled', label: 'Enabled' }
  }
  return { kind: 'enabled', label: 'Enabled' }
}

function kindFallback(entry: MarketplaceCatalogEntry): string {
  switch (entry.kind) {
    case 'mcp':
      return 'MCP'
    case 'skill':
      return 'Skill'
    case 'plugin':
      return 'Plugin'
    default: {
      const _exhaustive: never = entry.kind
      return _exhaustive
    }
  }
}

/** Featured / detail trailing button label when installed. */
export function installedActionLabel(activity: PackageActivity): string {
  switch (activity.kind) {
    case 'connected':
      return 'Connected'
    case 'enabled':
      return 'Enabled'
    case 'disabled':
      return 'Disabled'
    case 'installed':
    case 'coming-soon':
    case 'available':
      return 'Installed'
    default: {
      const _exhaustive: never = activity.kind
      return _exhaustive
    }
  }
}
