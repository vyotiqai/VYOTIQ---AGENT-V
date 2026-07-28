import { app } from 'electron'
import { join } from 'path'
import { userDataRoot } from '../storage/paths'

export function marketplaceRoot(): string {
  return join(userDataRoot(), 'marketplace')
}

export function marketplaceIndexPath(): string {
  return join(marketplaceRoot(), 'index.json')
}

export function marketplaceCatalogCachePath(): string {
  return join(marketplaceRoot(), 'cache', 'catalog.json')
}

export function marketplacePackagesRoot(): string {
  return join(marketplaceRoot(), 'packages')
}

export function marketplacePackageDir(id: string, version: string): string {
  return join(marketplacePackagesRoot(), id, version)
}

/** Bundled catalog + packages (dev vs packaged). */
export function bundledMarketplaceRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'marketplace')
  }
  return join(app.getAppPath(), 'resources', 'marketplace')
}

export function bundledCatalogPath(): string {
  return join(bundledMarketplaceRoot(), 'catalog.json')
}

export function bundledPackagePath(relativePath: string): string {
  return join(bundledMarketplaceRoot(), 'packages', relativePath)
}
