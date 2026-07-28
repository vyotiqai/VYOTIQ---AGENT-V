import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, extname, join, resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  MarketplaceInstallRequestSchema,
  type MarketplaceInstallRequest,
  type MarketplaceInstallResult,
  type MarketplaceInstallSource,
  type MarketplaceInstalledItem,
  type MarketplaceKind,
  VyotiqMcpManifestSchema,
  VyotiqPluginManifestSchema,
  type McpServer
} from '../../shared/ipc'
import { parseSkillFrontmatter } from '../agent/skills/parse'
import { getSettings, setSettings } from '../settings/settings'
import { formatError } from '../../shared/errors'
import { logger } from '../../shared/logger'
import { browseCatalog, refreshRemoteCatalog } from './catalog'
import { getInstalledItem, readMarketplaceIndex, upsertInstalledItem } from './indexStore'
import {
  bundledPackagePath,
  marketplacePackageDir,
  marketplacePackagesRoot
} from './paths'
import { remoteMcpIdFromUrl, headersWithoutAuthorization } from '../../shared/utils/mcpAuth'
import { setMcpAuthToken } from '../settings/secrets'
import { synthesizeVyotiqMcpManifest } from './mcpImport'

const execFileAsync = promisify(execFile)

export type DetectedPackage = {
  kind: MarketplaceKind
  id: string
  name: string
  version: string
  description: string
  root: string
}

export function detectPackageAt(root: string): DetectedPackage {
  const mcpPath = join(root, 'vyotiq.mcp.json')
  const pluginPath = join(root, 'vyotiq.plugin.json')
  const skillPath = join(root, 'skill.md')

  if (existsSync(mcpPath)) {
    const manifest = VyotiqMcpManifestSchema.parse(JSON.parse(readFileSync(mcpPath, 'utf8')))
    return {
      kind: 'mcp',
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      root
    }
  }
  if (existsSync(pluginPath)) {
    const manifest = VyotiqPluginManifestSchema.parse(JSON.parse(readFileSync(pluginPath, 'utf8')))
    return {
      kind: 'plugin',
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      root
    }
  }
  if (existsSync(skillPath)) {
    const skill = parseSkillFrontmatter(readFileSync(skillPath, 'utf8'))
    return {
      kind: 'skill',
      id: skill.name,
      name: skill.name,
      version: skill.version ?? '1.0.0',
      description: skill.description,
      root
    }
  }
  throw new Error('Not a Vyotiq package (need vyotiq.mcp.json, vyotiq.plugin.json, or skill.md)')
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  const ext = extname(archivePath).toLowerCase()
  if (ext === '.zip') {
    if (process.platform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
      ])
    } else {
      await execFileAsync('unzip', ['-o', archivePath, '-d', destDir])
    }
    return
  }
  // .tgz / .tar.gz
  await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir])
}

function findPackageRoot(extractedDir: string): string {
  if (
    existsSync(join(extractedDir, 'vyotiq.mcp.json')) ||
    existsSync(join(extractedDir, 'vyotiq.plugin.json')) ||
    existsSync(join(extractedDir, 'skill.md'))
  ) {
    return extractedDir
  }
  const kids = readdirSync(extractedDir, { withFileTypes: true }).filter((d) => d.isDirectory())
  for (const kid of kids) {
    const candidate = join(extractedDir, kid.name)
    if (
      existsSync(join(candidate, 'vyotiq.mcp.json')) ||
      existsSync(join(candidate, 'vyotiq.plugin.json')) ||
      existsSync(join(candidate, 'skill.md'))
    ) {
      return candidate
    }
  }
  throw new Error('Extracted archive does not contain a Vyotiq package')
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(dirname(destPath), { recursive: true })
  writeFileSync(destPath, buf)
}

function copyPackageIntoStore(srcRoot: string, id: string, version: string): string {
  const dest = marketplacePackageDir(id, version)
  const srcResolved = resolve(srcRoot)
  const destResolved = resolve(dest)
  // Path installs can point at an already-installed package dir; deleting dest
  // first would destroy the source before cpSync.
  if (srcResolved === destResolved) {
    return dest
  }
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true })
  }
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(srcRoot, dest, { recursive: true })
  return dest
}

export function mcpServerFromManifest(root: string): McpServer {
  const manifest = VyotiqMcpManifestSchema.parse(
    JSON.parse(readFileSync(join(root, 'vyotiq.mcp.json'), 'utf8'))
  )
  return {
    id: manifest.id,
    name: manifest.name,
    transport: manifest.transport,
    command: manifest.command,
    args: manifest.args,
    env: manifest.env,
    url: manifest.url,
    headers: manifest.headers,
    ...(manifest.allowedTools?.length ? { allowedTools: manifest.allowedTools } : {}),
    ...(manifest.deniedTools?.length ? { deniedTools: manifest.deniedTools } : {}),
    enabled: true,
    source: 'marketplace',
    packageId: manifest.id,
    packageVersion: manifest.version
  }
}

/** Sync marketplace-sourced MCP entries in settings.mcpServers from installed packages. */
export function syncMarketplaceMcpIntoSettings(): void {
  const index = readMarketplaceIndex()
  const settings = getSettings()
  const manual = (settings.mcpServers ?? []).filter((s) => s.source !== 'marketplace')
  const prevById = new Map(
    (settings.mcpServers ?? [])
      .filter((s) => s.source === 'marketplace')
      .map((s) => [s.id, s] as const)
  )
  const fromMarketplace: McpServer[] = []
  for (const item of index.items) {
    if (item.kind !== 'mcp') continue
    const root = join(marketplacePackagesRoot(), item.packagePath)
    if (!existsSync(join(root, 'vyotiq.mcp.json'))) continue
    try {
      const server = mcpServerFromManifest(root)
      server.enabled = item.enabled
      // Preserve user-edited connection fields from settings (manifest = defaults).
      const prev = prevById.get(server.id)
      if (prev) {
        if (prev.allowedTools) server.allowedTools = prev.allowedTools
        if (prev.deniedTools) server.deniedTools = prev.deniedTools
        if (prev.transport) server.transport = prev.transport
        if (prev.command !== undefined) server.command = prev.command
        if (prev.args) server.args = prev.args
        if (prev.env) server.env = prev.env
        if (prev.url !== undefined) server.url = prev.url
        if (prev.headers) server.headers = prev.headers
      }
      fromMarketplace.push(server)
    } catch (err) {
      logger.warn('Skip invalid marketplace MCP package', {
        scope: 'marketplace',
        id: item.id,
        err: formatError(err)
      })
    }
  }
  // Plugin-expanded MCP is handled in resolveEffectiveMcpServers
  setSettings({ mcpServers: [...manual, ...fromMarketplace] })
}

function registerInstalled(
  detected: DetectedPackage,
  installSource: MarketplaceInstallSource,
  packageRelPath: string
): MarketplaceInstalledItem {
  const prior = getInstalledItem(detected.id)
  const item: MarketplaceInstalledItem = {
    id: detected.id,
    kind: detected.kind,
    name: detected.name,
    version: detected.version,
    description: detected.description,
    // Preserve enablement across reinstall/upgrade of the same package id.
    enabled: prior?.enabled ?? true,
    installSource,
    installedAt: new Date().toISOString(),
    packagePath: packageRelPath
  }
  upsertInstalledItem(item)
  if (detected.kind === 'mcp') {
    syncMarketplaceMcpIntoSettings()
  }
  return item
}

async function materializeToTemp(req: MarketplaceInstallRequest): Promise<{
  root: string
  cleanup: () => void
  source: MarketplaceInstallSource
}> {
  const source = req.source
  const target = req.target.trim()

  if (source === 'path') {
    if (!existsSync(target)) throw new Error(`Path not found: ${target}`)
    return { root: target, cleanup: () => {}, source }
  }

  if (source === 'bundled') {
    const path = bundledPackagePath(target)
    if (!existsSync(path)) throw new Error(`Bundled package not found: ${target}`)
    return { root: path, cleanup: () => {}, source }
  }

  if (source === 'remote') {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(target)
    } catch {
      throw new Error(`Invalid remote MCP URL: ${target}`)
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Remote MCP URL must be http or https')
    }
    const transport = req.transport ?? 'http'
    const id = remoteMcpIdFromUrl(target, req.name)
    const name = (req.name ?? '').trim() || parsedUrl.hostname || id
    // Bearer goes to OS secure storage after install — never write into the package.
    const headers = headersWithoutAuthorization(req.headers)
    const tmp = mkdtempSync(join(tmpdir(), 'vyotiq-mkt-remote-'))
    const cleanup = (): void => {
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    const manifest = {
      schemaVersion: 1 as const,
      kind: 'mcp' as const,
      id,
      name,
      version: req.version?.trim() || '1.0.0',
      description: `Remote MCP (${transport}) at ${parsedUrl.origin}`,
      transport,
      url: target,
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
    }
    writeFileSync(join(tmp, 'vyotiq.mcp.json'), JSON.stringify(manifest, null, 2), 'utf8')
    return { root: tmp, cleanup, source }
  }

  const tmp = mkdtempSync(join(tmpdir(), 'vyotiq-mkt-'))
  const cleanup = (): void => {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }

  if (source === 'zip') {
    if (!existsSync(target)) {
      cleanup()
      throw new Error(`Zip not found: ${target}`)
    }
    const extractDir = join(tmp, 'extract')
    await extractArchive(target, extractDir)
    return { root: findPackageRoot(extractDir), cleanup, source }
  }

  if (source === 'git') {
    const cloneDir = join(tmp, 'repo')
    await execFileAsync('git', ['clone', '--depth', '1', target, cloneDir], {
      timeout: 120_000
    })
    return { root: findPackageRoot(cloneDir), cleanup, source }
  }

  if (source === 'npm') {
    const packDir = join(tmp, 'npm')
    mkdirSync(packDir, { recursive: true })
    const { stdout } = await execFileAsync('npm', ['pack', target, '--pack-destination', packDir], {
      timeout: 120_000
    })
    const tgzName = stdout.trim().split(/\r?\n/).filter(Boolean).pop()
    if (!tgzName) {
      cleanup()
      throw new Error('npm pack produced no tarball')
    }
    const tgzPath = join(packDir, basename(tgzName))
    const extractDir = join(tmp, 'extract')
    await extractArchive(tgzPath, extractDir)
    return { root: findPackageRoot(extractDir), cleanup, source }
  }

  if (source === 'registry') {
    await refreshRemoteCatalog()
    const entries = await browseCatalog()
    const entry = entries.find((e) => e.id === target)
    if (!entry) {
      cleanup()
      throw new Error(`Package not found in catalog: ${target}`)
    }
    if (entry.source === 'bundled' && entry.bundledPath) {
      cleanup()
      return {
        root: bundledPackagePath(entry.bundledPath),
        cleanup: () => {},
        source: 'bundled'
      }
    }
    const downloadUrl =
      entry.downloadUrl ??
      (() => {
        const registryUrl = (getSettings().marketplace?.registryUrl ?? '').trim().replace(/\/$/, '')
        if (!registryUrl) return null
        const version = req.version ?? entry.version
        return `${registryUrl}/v1/packages/${encodeURIComponent(entry.id)}/versions/${encodeURIComponent(version)}/download`
      })()
    if (!downloadUrl) {
      cleanup()
      throw new Error('No download URL for catalog entry')
    }
    const archivePath = join(tmp, 'pkg.zip')
    await downloadToFile(downloadUrl, archivePath)
    const extractDir = join(tmp, 'extract')
    try {
      await extractArchive(archivePath, extractDir)
    } catch {
      // try as tarball
      const tgzPath = join(tmp, 'pkg.tgz')
      renameSync(archivePath, tgzPath)
      await extractArchive(tgzPath, extractDir)
    }
    return { root: findPackageRoot(extractDir), cleanup, source }
  }

  cleanup()
  throw new Error(`Unsupported install source: ${source}`)
}

export async function installMarketplacePackage(
  raw: unknown
): Promise<MarketplaceInstallResult> {
  const req = MarketplaceInstallRequestSchema.parse(raw)
  const settings = getSettings()
  const remoteSources = new Set(['registry', 'git', 'npm', 'zip', 'remote'])
  if (remoteSources.has(req.source) && !settings.marketplace?.remoteInstallAcked) {
    throw new Error(
      'Acknowledge remote marketplace installs in Settings → Registry before installing from registry, git, npm, zip, or remote MCP URLs.'
    )
  }
  const { root, cleanup, source } = await materializeToTemp(req)
  try {
    let detected: DetectedPackage
    try {
      detected = detectPackageAt(root)
    } catch (err) {
      if (source === 'git' || source === 'npm' || source === 'zip' || source === 'path') {
        if (synthesizeVyotiqMcpManifest(root)) {
          detected = detectPackageAt(root)
        } else {
          throw err
        }
      } else {
        throw err
      }
    }
    if (req.kind && req.kind !== detected.kind) {
      throw new Error(`Expected kind ${req.kind} but package is ${detected.kind}`)
    }
    if (detected.kind === 'mcp') {
      const collision = (settings.mcpServers ?? []).find(
        (s) => s.id === detected.id && s.source !== 'marketplace'
      )
      if (collision) {
        throw new Error(
          `MCP id "${detected.id}" already exists as a configured server. Remove it in Settings → Marketplace first.`
        )
      }
      // Reject remote URL installs that would overwrite a different remote package id collision.
      const prior = getInstalledItem(detected.id)
      if (prior && prior.kind === 'mcp' && req.source === 'remote') {
        const priorRoot = join(marketplacePackagesRoot(), prior.packagePath)
        const priorManifest = join(priorRoot, 'vyotiq.mcp.json')
        if (existsSync(priorManifest)) {
          try {
            const prev = VyotiqMcpManifestSchema.parse(
              JSON.parse(readFileSync(priorManifest, 'utf8'))
            )
            if (prev.url && prev.url.trim() !== req.target.trim()) {
              throw new Error(
                `MCP id "${detected.id}" is already used by a different remote URL. Uninstall it first or choose a different name.`
              )
            }
          } catch (err) {
            if (err instanceof Error && err.message.includes('already used')) throw err
            // ignore unreadable prior manifest
          }
        }
      }
    }
    const dest = copyPackageIntoStore(detected.root, detected.id, detected.version)
    const rel = join(detected.id, detected.version).replace(/\\/g, '/')
    const item = registerInstalled(detected, source, rel)
    let authTokenStored: boolean | undefined
    if (req.source === 'remote' && req.bearerToken?.trim()) {
      try {
        setMcpAuthToken(detected.id, req.bearerToken.trim())
        authTokenStored = true
      } catch (err) {
        authTokenStored = false
        logger.warn('Remote MCP installed but auth token could not be stored securely', {
          scope: 'marketplace',
          id: detected.id,
          err: formatError(err)
        })
      }
    }
    logger.info('Marketplace package installed', {
      scope: 'marketplace',
      id: item.id,
      kind: item.kind,
      source
    })
    void dest
    return authTokenStored === undefined ? { item } : { item, authTokenStored }
  } finally {
    cleanup()
  }
}
