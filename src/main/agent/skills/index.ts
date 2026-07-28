import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { MarketplaceOverrides } from '../../../shared/ipc'
import { VyotiqPluginManifestSchema } from '../../../shared/ipc'
import { effectiveMarketplaceEnabled } from '../../../shared/domain/marketplaceEnablement'
import { parseSkillFrontmatter } from './parse'
import { readMarketplaceIndex } from '../../marketplace/indexStore'
import { marketplacePackagesRoot } from '../../marketplace/paths'

export type LoadedSkill = {
  id: string
  name: string
  description: string
  body: string
  source: 'skill' | 'plugin'
}

function loadSkillMd(path: string): { name: string; description: string; body: string } {
  const parsed = parseSkillFrontmatter(readFileSync(path, 'utf8'))
  return { name: parsed.name, description: parsed.description, body: parsed.body }
}

/** Load all effectively enabled skills (standalone + plugin-bundled). */
export function loadEnabledSkills(
  marketplaceOverrides?: MarketplaceOverrides | null
): LoadedSkill[] {
  const index = readMarketplaceIndex()
  const skills: LoadedSkill[] = []

  for (const item of index.items) {
    if (item.kind !== 'skill') continue
    if (!effectiveMarketplaceEnabled(item.id, item.enabled, marketplaceOverrides, 'skills')) {
      continue
    }
    const skillPath = join(marketplacePackagesRoot(), item.packagePath, 'skill.md')
    if (!existsSync(skillPath)) continue
    try {
      const loaded = loadSkillMd(skillPath)
      skills.push({
        id: item.id,
        name: loaded.name,
        description: loaded.description,
        body: loaded.body,
        source: 'skill'
      })
    } catch {
      // skip
    }
  }

  for (const item of index.items) {
    if (item.kind !== 'plugin') continue
    if (!effectiveMarketplaceEnabled(item.id, item.enabled, marketplaceOverrides, 'plugins')) {
      continue
    }
    const root = join(marketplacePackagesRoot(), item.packagePath)
    const manifestPath = join(root, 'vyotiq.plugin.json')
    if (!existsSync(manifestPath)) continue
    try {
      const plugin = VyotiqPluginManifestSchema.parse(
        JSON.parse(readFileSync(manifestPath, 'utf8'))
      )
      for (const rel of plugin.skills) {
        const skillPath = join(root, rel, 'skill.md')
        const alt = join(root, rel)
        const path = existsSync(skillPath)
          ? skillPath
          : existsSync(alt) && alt.endsWith('skill.md')
            ? alt
            : existsSync(join(root, `${rel}.md`))
              ? join(root, `${rel}.md`)
              : skillPath
        if (!existsSync(path)) continue
        const loaded = loadSkillMd(path)
        skills.push({
          id: `${plugin.id}/${loaded.name}`,
          name: loaded.name,
          description: loaded.description,
          body: loaded.body,
          source: 'plugin'
        })
      }
    } catch {
      // skip
    }
  }

  return skills
}

/** Format skills for system prompt (eager injection). */
export function buildSkillsSection(skills: LoadedSkill[], maxChars: number): string {
  if (skills.length === 0) return ''
  const blocks: string[] = ['## Marketplace skills']
  let used = blocks[0].length
  for (const skill of skills) {
    const block = [
      '',
      `### ${skill.name}`,
      `_${skill.description}_`,
      '',
      skill.body.trim()
    ].join('\n')
    if (used + block.length > maxChars) {
      blocks.push('\n_Additional skills omitted to fit context budget._')
      break
    }
    blocks.push(block)
    used += block.length
  }
  return blocks.join('\n').trim()
}

/** Load plugin rule markdown files for enabled plugins. */
export function loadPluginRules(
  marketplaceOverrides?: MarketplaceOverrides | null
): string {
  const index = readMarketplaceIndex()
  const parts: string[] = []
  for (const item of index.items) {
    if (item.kind !== 'plugin') continue
    if (!effectiveMarketplaceEnabled(item.id, item.enabled, marketplaceOverrides, 'plugins')) {
      continue
    }
    const root = join(marketplacePackagesRoot(), item.packagePath)
    const manifestPath = join(root, 'vyotiq.plugin.json')
    if (!existsSync(manifestPath)) continue
    try {
      const plugin = VyotiqPluginManifestSchema.parse(
        JSON.parse(readFileSync(manifestPath, 'utf8'))
      )
      for (const rel of plugin.rules) {
        const rulePath = join(root, rel)
        if (!existsSync(rulePath)) continue
        const text = readFileSync(rulePath, 'utf8').trim()
        if (!text) continue
        parts.push(`### Plugin rule: ${plugin.name} (${rel})\n${text}`)
      }
    } catch {
      // skip
    }
  }
  if (parts.length === 0) return ''
  return `## Plugin rules\n\n${parts.join('\n\n')}`
}
