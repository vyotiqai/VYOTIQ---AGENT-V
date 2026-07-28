import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { dirname } from 'path'
import { atomicWriteJson } from '../storage/atomicWrite'
import {
  MarketplaceIndexSchema,
  type MarketplaceIndex,
  type MarketplaceInstalledItem
} from '../../shared/ipc'
import { clearMcpAuthToken, clearMcpOAuthState } from '../settings/secrets'
import { marketplaceIndexPath, marketplacePackageDir, marketplaceRoot } from './paths'
import { logger } from '../../shared/logger'

const EMPTY_INDEX: MarketplaceIndex = { schemaVersion: 1, items: [] }

export function readMarketplaceIndex(): MarketplaceIndex {
  const path = marketplaceIndexPath()
  if (!existsSync(path)) return { ...EMPTY_INDEX, items: [] }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return MarketplaceIndexSchema.parse(raw)
  } catch (err) {
    logger.warn('Marketplace index unreadable; treating as empty', {
      scope: 'marketplace',
      err
    })
    return { ...EMPTY_INDEX, items: [] }
  }
}

export function writeMarketplaceIndex(index: MarketplaceIndex): void {
  mkdirSync(dirname(marketplaceIndexPath()), { recursive: true })
  mkdirSync(marketplaceRoot(), { recursive: true })
  atomicWriteJson(marketplaceIndexPath(), MarketplaceIndexSchema.parse(index))
}

export function upsertInstalledItem(item: MarketplaceInstalledItem): MarketplaceIndex {
  const index = readMarketplaceIndex()
  const prior = index.items.find((i) => i.id === item.id)
  if (prior && prior.version !== item.version) {
    const oldDir = marketplacePackageDir(prior.id, prior.version)
    if (existsSync(oldDir)) {
      try {
        rmSync(oldDir, { recursive: true, force: true })
      } catch (err) {
        logger.warn('Failed to remove prior marketplace package version', {
          scope: 'marketplace',
          id: prior.id,
          version: prior.version,
          err
        })
      }
    }
  }
  const nextItems = index.items.filter((i) => i.id !== item.id)
  nextItems.push(item)
  const next = { schemaVersion: 1 as const, items: nextItems }
  writeMarketplaceIndex(next)
  return next
}

export function setInstalledEnabled(id: string, enabled: boolean): MarketplaceIndex {
  const index = readMarketplaceIndex()
  const items = index.items.map((i) => (i.id === id ? { ...i, enabled } : i))
  const next = { schemaVersion: 1 as const, items }
  writeMarketplaceIndex(next)
  return next
}

export function removeInstalledItem(id: string): MarketplaceIndex {
  const index = readMarketplaceIndex()
  const item = index.items.find((i) => i.id === id)
  if (item) {
    const dir = marketplacePackageDir(item.id, item.version)
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
    try {
      clearMcpAuthToken(item.id)
      clearMcpOAuthState(item.id)
    } catch {
      // ignore
    }
  }
  const next = {
    schemaVersion: 1 as const,
    items: index.items.filter((i) => i.id !== id)
  }
  writeMarketplaceIndex(next)
  return next
}

export function getInstalledItem(id: string): MarketplaceInstalledItem | undefined {
  return readMarketplaceIndex().items.find((i) => i.id === id)
}
