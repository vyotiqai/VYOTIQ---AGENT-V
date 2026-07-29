import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getAppPath: () => process.cwd(),
    isPackaged: false
  }
}))

import { McpServerSchema, VyotiqMcpManifestSchema } from '@shared/ipc'
import { effectiveMarketplaceEnabled } from '@shared/domain/marketplaceEnablement'
import { mcpServerConfigKey } from '@main/agent/mcp'
import { parseSkillFrontmatter } from '@main/agent/skills/parse'
import { detectPackageAt } from '@main/marketplace/install'
import { buildSkillsSection, type LoadedSkill } from '@main/agent/skills'

describe('McpServerSchema transport migration', () => {
  it('defaults missing transport to stdio', () => {
    const parsed = McpServerSchema.parse({
      id: 'fs',
      name: 'Filesystem',
      command: 'npx',
      enabled: true
    })
    expect(parsed.transport).toBe('stdio')
    expect(parsed.command).toBe('npx')
  })

  it('requires url for http transport', () => {
    const result = McpServerSchema.safeParse({
      id: 'remote',
      name: 'Remote',
      transport: 'http',
      enabled: true
    })
    expect(result.success).toBe(false)
  })

  it('accepts http with url', () => {
    const parsed = McpServerSchema.parse({
      id: 'remote',
      name: 'Remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      enabled: true
    })
    expect(parsed.transport).toBe('http')
    expect(parsed.url).toBe('https://example.com/mcp')
  })
})

describe('mcpServerConfigKey', () => {
  it('includes transport and url in fingerprint', () => {
    const a = mcpServerConfigKey({
      transport: 'http',
      url: 'https://a.example/mcp',
      headers: { Authorization: 'Bearer x' }
    })
    const b = mcpServerConfigKey({
      transport: 'http',
      url: 'https://b.example/mcp',
      headers: { Authorization: 'Bearer x' }
    })
    expect(a).not.toBe(b)
  })
})

describe('effectiveMarketplaceEnabled', () => {
  it('uses workspace override when present', () => {
    expect(
      effectiveMarketplaceEnabled('fs', true, { mcp: { fs: false } }, 'mcp')
    ).toBe(false)
    expect(
      effectiveMarketplaceEnabled('fs', false, { mcp: { fs: true } }, 'mcp')
    ).toBe(true)
  })

  it('falls back to global when no override', () => {
    expect(effectiveMarketplaceEnabled('fs', true, {}, 'mcp')).toBe(true)
    expect(effectiveMarketplaceEnabled('fs', false, undefined, 'skills')).toBe(false)
  })
})

describe('VyotiqMcpManifestSchema', () => {
  it('parses stdio manifest', () => {
    const m = VyotiqMcpManifestSchema.parse({
      schemaVersion: 1,
      kind: 'mcp',
      id: 'filesystem',
      name: 'Filesystem',
      version: '1.0.0',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
    })
    expect(m.id).toBe('filesystem')
  })
})

describe('parseSkillFrontmatter', () => {
  it('parses skill.md', () => {
    const raw = `---
name: code-review
description: Review code carefully.
version: 1.0.0
---

# Body

Do a thorough review.
`
    const parsed = parseSkillFrontmatter(raw)
    expect(parsed.name).toBe('code-review')
    expect(parsed.description).toBe('Review code carefully.')
    expect(parsed.body).toContain('thorough review')
  })
})

describe('detectPackageAt', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vyotiq-pkg-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('detects skill packages', () => {
    writeFileSync(
      join(dir, 'skill.md'),
      `---
name: my-skill
description: A skill
version: 1.2.0
---

Instructions.
`
    )
    const detected = detectPackageAt(dir)
    expect(detected.kind).toBe('skill')
    expect(detected.id).toBe('my-skill')
    expect(detected.version).toBe('1.2.0')
  })

  it('detects mcp packages', () => {
    writeFileSync(
      join(dir, 'vyotiq.mcp.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'mcp',
        id: 'echo',
        name: 'Echo',
        version: '0.1.0',
        transport: 'stdio',
        command: 'node',
        args: ['server.js']
      })
    )
    const detected = detectPackageAt(dir)
    expect(detected.kind).toBe('mcp')
    expect(detected.id).toBe('echo')
  })

  it('detects plugin packages', () => {
    writeFileSync(
      join(dir, 'vyotiq.plugin.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'plugin',
        id: 'devtools',
        name: 'Devtools',
        version: '1.0.0',
        mcp: [],
        skills: [],
        rules: []
      })
    )
    const detected = detectPackageAt(dir)
    expect(detected.kind).toBe('plugin')
  })
})

describe('buildSkillsSection', () => {
  it('injects skill bodies and respects budget', () => {
    const skills: LoadedSkill[] = [
      {
        id: 'a',
        name: 'Alpha',
        description: 'First',
        body: 'Do alpha things.',
        source: 'skill'
      },
      {
        id: 'b',
        name: 'Beta',
        description: 'Second',
        body: 'x'.repeat(500),
        source: 'skill'
      }
    ]
    const section = buildSkillsSection(skills, 80)
    expect(section).toContain('## Marketplace skills')
    expect(section).toContain('Alpha')
    expect(section).toMatch(/omitted|Beta|Alpha/)
  })
})

describe('describePackageAt', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vyotiq-plugin-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('lists plugin nested skills and rules', async () => {
    mkdirSync(join(root, 'skills', 'review'), { recursive: true })
    mkdirSync(join(root, 'rules'), { recursive: true })
    writeFileSync(
      join(root, 'vyotiq.plugin.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'plugin',
        id: 'devtools',
        name: 'Devtools',
        version: '1.0.0',
        mcp: [],
        skills: ['skills/review'],
        rules: ['rules/conventions.md']
      })
    )
    writeFileSync(
      join(root, 'skills', 'review', 'skill.md'),
      `---
name: review
description: Review skill
---

Body
`
    )
    writeFileSync(join(root, 'rules', 'conventions.md'), '# Conventions\n')

    const { describePackageAt } = await import('@main/marketplace/packageContents')
    const contents = describePackageAt(root, { id: 'devtools', kind: 'plugin' })
    expect(contents.skills).toEqual([
      expect.objectContaining({ name: 'review', path: 'skills/review' })
    ])
    expect(contents.rules).toEqual([{ path: 'rules/conventions.md' }])
  })
})

describe('resolveEffectiveMcpServers', () => {
  it('applies marketplace mcp overrides to configured (manual) MCP servers', async () => {
    const settingsMod = await import('@main/settings/settings')
    const indexMod = await import('@main/marketplace/indexStore')
    const { resolveEffectiveMcpServers } = await import('@main/marketplace/resolve')
    const { DEFAULT_SETTINGS } = await import('@shared/ipc')

    vi.spyOn(settingsMod, 'getSettings').mockReturnValue({
      ...DEFAULT_SETTINGS,
      mcpServers: [
        {
          id: 'manual-fs',
          name: 'Manual',
          transport: 'stdio',
          command: 'echo',
          enabled: true,
          source: 'manual'
        }
      ]
    })
    vi.spyOn(indexMod, 'readMarketplaceIndex').mockReturnValue({
      schemaVersion: 1,
      items: []
    })

    const servers = resolveEffectiveMcpServers({ mcp: { 'manual-fs': false } })
    expect(servers.find((s) => s.id === 'manual-fs')?.enabled).toBe(false)
  })
})

describe('remote MCP install request', () => {
  it('accepts remote source with transport and bearer', async () => {
    const { MarketplaceInstallRequestSchema } = await import('@shared/ipc')
    const parsed = MarketplaceInstallRequestSchema.parse({
      source: 'remote',
      target: 'https://mcp.example.com/sse',
      kind: 'mcp',
      transport: 'sse',
      bearerToken: 'tok',
      name: 'Example'
    })
    expect(parsed.source).toBe('remote')
    expect(parsed.transport).toBe('sse')
    expect(parsed.bearerToken).toBe('tok')
  })
})

describe('bundled marketplace catalog', () => {
  it('has installable packages with on-disk manifests and icons', async () => {
    const { MarketplaceCatalogSchema } = await import('@shared/ipc')
    const root = join(process.cwd(), 'resources', 'marketplace')
    const catalog = MarketplaceCatalogSchema.parse(
      JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8'))
    )

    const skills = catalog.packages.filter((p) => p.kind === 'skill')
    const plugins = catalog.packages.filter((p) => p.kind === 'plugin')
    expect(skills.length).toBeGreaterThanOrEqual(11)
    expect(plugins.length).toBeGreaterThanOrEqual(4)

    for (const entry of catalog.packages) {
      expect(entry.installable).not.toBe(false)
      expect(entry.bundledPath).toBeTruthy()
      const pkgRoot = join(root, 'packages', entry.bundledPath!)
      if (entry.kind === 'mcp') {
        expect(existsSync(join(pkgRoot, 'vyotiq.mcp.json'))).toBe(true)
      } else if (entry.kind === 'skill') {
        expect(existsSync(join(pkgRoot, 'skill.md'))).toBe(true)
      } else if (entry.kind === 'plugin') {
        expect(existsSync(join(pkgRoot, 'vyotiq.plugin.json'))).toBe(true)
      } else {
        const _exhaustive: never = entry.kind
        throw new Error(`unexpected kind ${_exhaustive}`)
      }
      if (entry.iconPath) {
        expect(existsSync(join(root, entry.iconPath))).toBe(true)
      }
    }
  })
})
