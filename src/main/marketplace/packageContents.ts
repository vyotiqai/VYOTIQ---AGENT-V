import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  VyotiqMcpManifestSchema,
  VyotiqPluginManifestSchema,
  type MarketplaceInstalledItem,
  type MarketplaceKind
} from '../../shared/ipc'
import { parseSkillFrontmatter } from '../agent/skills/parse'
import { getInstalledItem } from './indexStore'
import { marketplacePackagesRoot } from './paths'

export type PackageContents = {
  id: string
  kind: MarketplaceKind
  mcp: Array<{ id: string; name: string; path: string }>
  skills: Array<{ name: string; description: string; path: string }>
  rules: Array<{ path: string }>
}

/** Describe nested contents of an installed package (for Marketplace UI detail). */
export function getInstalledPackageContents(id: string): PackageContents | null {
  const item = getInstalledItem(id)
  if (!item) return null
  return describePackageAt(join(marketplacePackagesRoot(), item.packagePath), item)
}

export function describePackageAt(
  root: string,
  item: Pick<MarketplaceInstalledItem, 'id' | 'kind'>
): PackageContents {
  const out: PackageContents = {
    id: item.id,
    kind: item.kind,
    mcp: [],
    skills: [],
    rules: []
  }

  if (item.kind === 'mcp') {
    const manifestPath = join(root, 'vyotiq.mcp.json')
    if (existsSync(manifestPath)) {
      const m = VyotiqMcpManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')))
      out.mcp.push({ id: m.id, name: m.name, path: 'vyotiq.mcp.json' })
    }
    return out
  }

  if (item.kind === 'skill') {
    const skillPath = join(root, 'skill.md')
    if (existsSync(skillPath)) {
      const skill = parseSkillFrontmatter(readFileSync(skillPath, 'utf8'))
      out.skills.push({
        name: skill.name,
        description: skill.description,
        path: 'skill.md'
      })
    }
    return out
  }

  const pluginPath = join(root, 'vyotiq.plugin.json')
  if (!existsSync(pluginPath)) return out
  const plugin = VyotiqPluginManifestSchema.parse(JSON.parse(readFileSync(pluginPath, 'utf8')))
  for (const rel of plugin.mcp) {
    const mcpManifest = join(root, rel, 'vyotiq.mcp.json')
    if (!existsSync(mcpManifest)) continue
    try {
      const m = VyotiqMcpManifestSchema.parse(JSON.parse(readFileSync(mcpManifest, 'utf8')))
      out.mcp.push({ id: m.id, name: m.name, path: rel })
    } catch {
      // skip
    }
  }
  for (const rel of plugin.skills) {
    const skillPath = join(root, rel, 'skill.md')
    if (!existsSync(skillPath)) continue
    try {
      const skill = parseSkillFrontmatter(readFileSync(skillPath, 'utf8'))
      out.skills.push({ name: skill.name, description: skill.description, path: rel })
    } catch {
      // skip
    }
  }
  for (const rel of plugin.rules) {
    if (existsSync(join(root, rel))) out.rules.push({ path: rel })
  }
  return out
}
