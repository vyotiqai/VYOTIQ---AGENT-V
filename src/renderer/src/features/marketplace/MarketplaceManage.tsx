import { useEffect, useState } from 'react'
import type {
  DetectedMcpServer,
  MarketplaceInstalledItem,
  McpDetectResult,
  McpServer,
  PackageContents,
  Settings,
  WorkspaceSettingsOverride
} from '@shared/ipc'
import { Button, Input } from '@renderer/lib/ui'
import { Icon } from '@renderer/lib/icons'
import { McpServerCard } from '@renderer/features/settings/components/McpServerCard'
import {
  isValidHttpUrl,
  mcpStatusClass,
  mcpStatusLabel
} from '@renderer/features/settings/utils/settingsHelpers'
import { MarketplaceFeedbackBanner } from './MarketplaceFeedbackBanner'
import { kindLabel } from './marketplaceLabels'
import type { MarketplaceController } from './useMarketplaceController'

type ManageTab = 'installed' | 'add'

function nestedPluginMcpServerId(pluginId: string, nestedId: string): string {
  return `plugin-${pluginId}-${nestedId}`.replace(/__/g, '-')
}

function aggregateMcpStatuses(
  statuses: Array<ReturnType<MarketplaceController['mcpStatusById']['get']>>
): ReturnType<MarketplaceController['mcpStatusById']['get']> {
  const defined = statuses.filter((s): s is NonNullable<typeof s> => s != null)
  if (defined.length === 0) return undefined
  const connected = defined.filter((s) => s.connected)
  const enabled = defined.some((s) => s.enabled)
  const toolCount = defined.reduce((n, s) => n + (s.toolCount ?? 0), 0)
  const errors = defined.map((s) => s.error).filter((e): e is string => Boolean(e))
  const hasAuthToken = defined.some((s) => s.hasAuthToken === true)
  return {
    id: defined[0]!.id,
    name: defined[0]!.name,
    enabled,
    connected: connected.length > 0,
    toolCount,
    ...(hasAuthToken ? { hasAuthToken: true } : {}),
    ...(errors[0] ? { error: errors[0] } : {})
  }
}

function InstalledPackageContents({
  itemId,
  onContents
}: {
  itemId: string
  onContents?: (contents: PackageContents | null) => void
}) {
  const [contents, setContents] = useState<PackageContents | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await window.vyotiq.marketplaceGetContents(itemId)
      if (cancelled) return
      if (!res.ok) {
        setContents(null)
        onContents?.(null)
        return
      }
      setContents(res.data)
      onContents?.(res.data)
    })()
    return () => {
      cancelled = true
    }
  }, [itemId, onContents])

  if (!contents) return null
  const parts: string[] = []
  if (contents.mcp.length) {
    parts.push(`MCP: ${contents.mcp.map((m) => m.name).join(', ')}`)
  }
  if (contents.skills.length) {
    parts.push(`Skills: ${contents.skills.map((s) => s.name).join(', ')}`)
  }
  if (contents.rules.length) {
    parts.push(`Rules: ${contents.rules.map((r) => r.path).join(', ')}`)
  }
  if (parts.length === 0) return null
  return <p className="m-0 mt-1 text-muted">{parts.join(' · ')}</p>
}

function InstalledMarketplaceItem({
  item,
  controller,
  settings,
  linked,
  ws,
  activeWorkspacePath,
  canOverride,
  setWorkspaceEnable,
  clearWorkspaceEnable,
  workspaceEnabledForId
}: {
  item: MarketplaceInstalledItem
  controller: MarketplaceController
  settings: Settings
  linked: McpServer | undefined
  ws: boolean | undefined
  activeWorkspacePath?: string | null
  canOverride: boolean
  setWorkspaceEnable: (
    kind: 'mcp' | 'skills' | 'plugins',
    id: string,
    enabled: boolean
  ) => Promise<void>
  clearWorkspaceEnable: (kind: 'mcp' | 'skills' | 'plugins', id: string) => Promise<void>
  workspaceEnabledForId: (kind: 'mcp' | 'skills' | 'plugins', id: string) => boolean | undefined
}) {
  const [pluginContents, setPluginContents] = useState<PackageContents | null>(null)
  const { formLocked, mcpStatusById, runUpdate, setEnabled, uninstall } = controller

  const status = (() => {
    if (item.kind === 'mcp') {
      return linked ? mcpStatusById.get(linked.id) : mcpStatusById.get(item.id)
    }
    if (item.kind === 'plugin') {
      if (!pluginContents?.mcp.length) return undefined
      return aggregateMcpStatuses(
        pluginContents.mcp.map((m) => mcpStatusById.get(nestedPluginMcpServerId(item.id, m.id)))
      )
    }
    return undefined
  })()

  const showMcpStatus =
    item.kind === 'mcp' || (item.kind === 'plugin' && (pluginContents?.mcp.length ?? 0) > 0)

  const overrideKind =
    item.kind === 'mcp' ? 'mcp' : item.kind === 'skill' ? 'skills' : 'plugins'

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 font-medium text-fg">
          {item.name} <span className="text-muted">({kindLabel(item.kind)})</span>
        </p>
        <label className="inline-flex items-center gap-1.5 text-secondary">
          <input
            type="checkbox"
            className="size-3.5 accent-fg"
            checked={item.enabled}
            disabled={formLocked}
            aria-label={`Enable ${item.name}`}
            onChange={(e) => void setEnabled(item, e.target.checked)}
          />
          Global
        </label>
      </div>
      <p className="m-0 mt-1 text-secondary">{item.description || '—'}</p>
      {showMcpStatus && !linked ? (
        <p className={`m-0 mt-1 ${mcpStatusClass(status, { workspaceEnabled: ws })}`}>
          {mcpStatusLabel(status, { workspaceEnabled: ws })}
        </p>
      ) : null}
      {status?.error && !linked ? (
        <p className="m-0 mt-1 text-danger [overflow-wrap:anywhere]">{status.error}</p>
      ) : null}
      <InstalledPackageContents
        itemId={item.id}
        onContents={item.kind === 'plugin' ? setPluginContents : undefined}
      />
      {linked && item.kind === 'mcp' ? (
        <div className="mt-2">
          <McpServerCard
            server={linked}
            status={status}
            disabled={formLocked}
            hideEnable
            hideRemove
            onUpdate={async (next) => {
              const updated = settings.mcpServers.map((s) => (s.id === linked.id ? next : s))
              return runUpdate({ mcpServers: updated })
            }}
            onRemove={() => undefined}
            onAuthChanged={() => {
              void controller.loadMcpStatus(true)
            }}
          />
          {ws === false ? (
            <p className={`m-0 mt-1 ${mcpStatusClass(status, { workspaceEnabled: false })}`}>
              {mcpStatusLabel(status, { workspaceEnabled: false })}
            </p>
          ) : null}
        </div>
      ) : null}
      {item.kind === 'plugin' && pluginContents && pluginContents.mcp.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          <p className="m-0 text-[11px] font-medium text-secondary">Plugin MCP servers</p>
          {pluginContents.mcp.map((nested) => {
            const nestedId = nestedPluginMcpServerId(item.id, nested.id)
            const overlay = settings.mcpServers.find((s) => s.id === nestedId)
            const nestedStatus = mcpStatusById.get(nestedId)
            const nestedWs = workspaceEnabledForId('mcp', nestedId)
            const server: McpServer = overlay ?? {
              id: nestedId,
              name: `${item.name}: ${nested.name}`,
              transport: nested.transport ?? 'stdio',
              command: nested.command,
              url: nested.url,
              enabled: true,
              source: 'marketplace',
              packageId: item.id
            }
            return (
              <div key={nestedId} className="flex flex-col gap-1">
                <McpServerCard
                  server={server}
                  status={nestedStatus}
                  disabled={formLocked}
                  hideEnable
                  hideRemove
                  onUpdate={async (next) => {
                    const others = settings.mcpServers.filter((s) => s.id !== nestedId)
                    return runUpdate({ mcpServers: [...others, next] })
                  }}
                  onRemove={() => undefined}
                  onAuthChanged={() => {
                    void controller.loadMcpStatus(true)
                  }}
                />
                {activeWorkspacePath && canOverride ? (
                  <div className="flex flex-wrap items-center gap-2 px-0.5">
                    <span className="text-muted text-[11px]">This MCP in workspace:</span>
                    <Button
                      variant="subtle"
                      disabled={formLocked}
                      aria-pressed={nestedWs === true}
                      onClick={() => void setWorkspaceEnable('mcp', nestedId, true)}
                    >
                      Force on{nestedWs === true ? ' ✓' : ''}
                    </Button>
                    <Button
                      variant="subtle"
                      disabled={formLocked}
                      aria-pressed={nestedWs === false}
                      onClick={() => void setWorkspaceEnable('mcp', nestedId, false)}
                    >
                      Force off{nestedWs === false ? ' ✓' : ''}
                    </Button>
                    <Button
                      variant="subtle"
                      disabled={formLocked || nestedWs === undefined}
                      onClick={() => void clearWorkspaceEnable('mcp', nestedId)}
                    >
                      Use global
                    </Button>
                  </div>
                ) : null}
                {nestedWs === false ? (
                  <p
                    className={`m-0 px-0.5 ${mcpStatusClass(nestedStatus, { workspaceEnabled: false })}`}
                  >
                    {mcpStatusLabel(nestedStatus, { workspaceEnabled: false })}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {activeWorkspacePath && canOverride ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-muted">This workspace:</span>
          <Button
            variant="subtle"
            disabled={formLocked}
            aria-pressed={ws === true}
            onClick={() => void setWorkspaceEnable(overrideKind, item.id, true)}
          >
            Force on{ws === true ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={formLocked}
            aria-pressed={ws === false}
            onClick={() => void setWorkspaceEnable(overrideKind, item.id, false)}
          >
            Force off{ws === false ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={formLocked || ws === undefined}
            onClick={() => void clearWorkspaceEnable(overrideKind, item.id)}
          >
            Use global
          </Button>
        </div>
      ) : null}
      <Button
        variant="subtle"
        className="mt-2"
        disabled={formLocked}
        onClick={() => void uninstall(item.id)}
      >
        Uninstall
      </Button>
    </div>
  )
}

function ManualMcpInstalledItem({
  server,
  controller,
  settings,
  ws,
  activeWorkspacePath,
  canOverride,
  setWorkspaceEnable,
  clearWorkspaceEnable
}: {
  server: McpServer
  controller: MarketplaceController
  settings: Settings
  ws: boolean | undefined
  activeWorkspacePath?: string | null
  canOverride: boolean
  setWorkspaceEnable: (
    kind: 'mcp' | 'skills' | 'plugins',
    id: string,
    enabled: boolean
  ) => Promise<void>
  clearWorkspaceEnable: (kind: 'mcp' | 'skills' | 'plugins', id: string) => Promise<void>
}) {
  const { formLocked, mcpStatusById, runUpdate, loadMcpStatus } = controller

  return (
    <>
      <McpServerCard
        server={server}
        status={mcpStatusById.get(server.id)}
        disabled={formLocked}
        onUpdate={async (next) => {
          const updated = settings.mcpServers.map((s) => (s.id === server.id ? next : s))
          return runUpdate({ mcpServers: updated })
        }}
        onRemove={() => {
          void (async () => {
            await window.vyotiq.mcpClearAuthToken?.(server.id)
            await runUpdate({
              mcpServers: settings.mcpServers.filter((s) => s.id !== server.id)
            })
          })()
        }}
        onAuthChanged={() => {
          void loadMcpStatus(true)
        }}
      />
      {ws === false ? (
        <p
          className={`m-0 mt-1 px-0.5 text-xs ${mcpStatusClass(mcpStatusById.get(server.id), { workspaceEnabled: false })}`}
        >
          {mcpStatusLabel(mcpStatusById.get(server.id), { workspaceEnabled: false })}
        </p>
      ) : null}      {activeWorkspacePath && canOverride ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-0.5">
          <span className="text-muted text-xs">This workspace:</span>
          <Button
            variant="subtle"
            disabled={formLocked}
            aria-pressed={ws === true}
            onClick={() => void setWorkspaceEnable('mcp', server.id, true)}
          >
            Force on{ws === true ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={formLocked}
            aria-pressed={ws === false}
            onClick={() => void setWorkspaceEnable('mcp', server.id, false)}
          >
            Force off{ws === false ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={formLocked || ws === undefined}
            onClick={() => void clearWorkspaceEnable('mcp', server.id)}
          >
            Use global
          </Button>
        </div>
      ) : null}
    </>
  )
}

export function MarketplaceManage({
  controller,
  settings,
  activeWorkspacePath,
  settingsOverridesByPath,
  onSetSettingsOverride,
  onBack
}: {
  controller: MarketplaceController
  settings: Settings
  activeWorkspacePath?: string | null
  settingsOverridesByPath?: Record<string, WorkspaceSettingsOverride>
  onSetSettingsOverride?: (
    path: string,
    override: WorkspaceSettingsOverride | null
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  onBack: () => void
}) {
  const [tab, setTab] = useState<ManageTab>('installed')
  const [pasteInput, setPasteInput] = useState('')
  const [detectResult, setDetectResult] = useState<McpDetectResult | null>(null)
  const [editServer, setEditServer] = useState<DetectedMcpServer | null>(null)
  const [serverDirty, setServerDirty] = useState(false)
  const [overwriteDup, setOverwriteDup] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [importPreview, setImportPreview] = useState<DetectedMcpServer[] | null>(null)
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set())
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [gitUrl, setGitUrl] = useState('')
  const [npmName, setNpmName] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteName, setRemoteName] = useState('')
  const [remoteTransport, setRemoteTransport] = useState<'http' | 'sse'>('http')
  const [remoteBearer, setRemoteBearer] = useState('')
  const [stdioName, setStdioName] = useState('New MCP server')
  const [stdioCommand, setStdioCommand] = useState('npx')
  const [stdioArgs, setStdioArgs] = useState('-y\n@modelcontextprotocol/server-filesystem\n.')

  const {
    installed,
    formLocked,
    feedback,
    setFeedback,
    runInstall,
    runUpdate,
    loadMcpStatus,
    mcpStatusLoading,
    detectMcp,
    applyDetectedMcp,
    scanExternalMcp,
    importExternalMcp
  } = controller

  const patchEditServer = (next: DetectedMcpServer): void => {
    setServerDirty(true)
    setEditServer(next)
  }

  const manualServers = settings.mcpServers.filter((s) => s.source !== 'marketplace')

  const workspaceOverride =
    activeWorkspacePath && settingsOverridesByPath
      ? settingsOverridesByPath[activeWorkspacePath]
      : undefined

  const setWorkspaceEnable = async (
    kind: 'mcp' | 'skills' | 'plugins',
    id: string,
    enabled: boolean
  ) => {
    if (!activeWorkspacePath || !onSetSettingsOverride) return
    // If chat override was off, start a marketplace-only override so Force on/off
    // does not resurrect stale provider/model fields left from a previous override.
    const prev =
      workspaceOverride?.useOverride === true
        ? workspaceOverride
        : {
            useOverride: true as const,
            marketplaceOverrides: workspaceOverride?.marketplaceOverrides
          }
    const marketplaceOverrides = {
      ...(prev.marketplaceOverrides ?? {}),
      [kind]: {
        ...(prev.marketplaceOverrides?.[kind] ?? {}),
        [id]: enabled
      }
    }
    const res = await onSetSettingsOverride(activeWorkspacePath, {
      ...prev,
      useOverride: true,
      marketplaceOverrides
    })
    if (!res.ok) setFeedback({ kind: 'error', text: res.error })
  }

  const clearWorkspaceEnable = async (
    kind: 'mcp' | 'skills' | 'plugins',
    id: string
  ) => {
    if (!activeWorkspacePath || !onSetSettingsOverride || !workspaceOverride) return
    const kindMap = { ...(workspaceOverride.marketplaceOverrides?.[kind] ?? {}) }
    if (!Object.prototype.hasOwnProperty.call(kindMap, id)) return
    delete kindMap[id]
    const marketplaceOverrides = {
      ...(workspaceOverride.marketplaceOverrides ?? {}),
      [kind]: kindMap
    }
    const res = await onSetSettingsOverride(activeWorkspacePath, {
      ...workspaceOverride,
      useOverride: true,
      marketplaceOverrides
    })
    if (!res.ok) setFeedback({ kind: 'error', text: res.error })
  }

  const workspaceEnabledForId = (
    kind: 'mcp' | 'skills' | 'plugins',
    id: string
  ): boolean | undefined => {
    if (!workspaceOverride?.useOverride) return undefined
    const map = workspaceOverride.marketplaceOverrides?.[kind]
    if (map && Object.prototype.hasOwnProperty.call(map, id)) return map[id]
    return undefined
  }

  const workspaceEnabled = (item: MarketplaceInstalledItem): boolean | undefined => {
    const kind = item.kind === 'mcp' ? 'mcp' : item.kind === 'skill' ? 'skills' : 'plugins'
    return workspaceEnabledForId(kind, item.id)
  }

  const mcpServerForPackage = (item: MarketplaceInstalledItem) =>
    settings.mcpServers.find(
      (s) => s.source === 'marketplace' && (s.packageId === item.id || s.id === item.id)
    )

  const addStdioMcp = async (): Promise<void> => {
    const id = crypto.randomUUID()
    const args = stdioArgs
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const next: McpServer = {
      id,
      name: stdioName.trim() || 'New MCP server',
      transport: 'stdio',
      command: stdioCommand.trim() || 'npx',
      args: args.length > 0 ? args : undefined,
      enabled: true,
      source: 'manual'
    }
    const ok = await runUpdate({ mcpServers: [...settings.mcpServers, next] })
    if (ok) {
      setFeedback({ kind: 'success', text: `Added MCP server "${next.name}"` })
      setTab('installed')
      setStdioName('New MCP server')
      setStdioCommand('npx')
      setStdioArgs('-y\n@modelcontextprotocol/server-filesystem\n.')
      await loadMcpStatus(true)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex items-center gap-1.5 text-xs text-muted" aria-label="Breadcrumb">
          <button
            type="button"
            className="text-secondary vy-transition hover:text-fg focus-visible:vy-focus-ring"
            onClick={onBack}
          >
            Marketplace
          </button>
          <Icon name="chevronRight" size={12} className="text-muted" />
          <span className="text-fg">Manage</span>
        </nav>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Manage marketplace">
          {(['installed', 'add'] as ManageTab[]).map((t) => (
            <Button
              key={t}
              role="tab"
              aria-selected={tab === t}
              variant="subtle"
              className={tab === t ? 'bg-surface-2 text-fg-strong' : undefined}
              disabled={formLocked}
              onClick={() => setTab(t)}
            >
              {t === 'installed' ? 'Installed' : 'Add'}
            </Button>
          ))}
        </div>
      </div>

      {activeWorkspacePath && onSetSettingsOverride ? (
        <p className="m-0 rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-secondary">
          Force on/off enables workspace overrides for this workspace and overrides global package
          enablement for agent runs here. Global MCP connections stay up for other workspaces
          (Settings → General → Workspaces).
        </p>
      ) : null}

      <MarketplaceFeedbackBanner feedback={feedback} />

      {tab === 'installed' ? (
        <div className="flex flex-col gap-2">
          <div className="flex justify-end">
            <Button
              variant="subtle"
              disabled={formLocked || mcpStatusLoading}
              onClick={() => void loadMcpStatus(true)}
            >
              {mcpStatusLoading ? 'Refreshing…' : 'Refresh MCP connections'}
            </Button>
          </div>
          {manualServers.length === 0 && installed.items.length === 0 ? (
            <p className="m-0 text-xs text-muted">
              Nothing installed yet. Use Add to configure a stdio or remote MCP, or browse the
              marketplace catalog.
            </p>
          ) : (
            <>
              {manualServers.map((server) => (
                <ManualMcpInstalledItem
                  key={server.id}
                  server={server}
                  controller={controller}
                  settings={settings}
                  ws={workspaceEnabledForId('mcp', server.id)}
                  activeWorkspacePath={activeWorkspacePath}
                  canOverride={!!onSetSettingsOverride}
                  setWorkspaceEnable={setWorkspaceEnable}
                  clearWorkspaceEnable={clearWorkspaceEnable}
                />
              ))}
              {installed.items.map((item) => (
                <InstalledMarketplaceItem
                  key={item.id}
                  item={item}
                  controller={controller}
                  settings={settings}
                  linked={item.kind === 'mcp' ? mcpServerForPackage(item) : undefined}
                  ws={workspaceEnabled(item)}
                  activeWorkspacePath={activeWorkspacePath}
                  canOverride={!!onSetSettingsOverride}
                  setWorkspaceEnable={setWorkspaceEnable}
                  clearWorkspaceEnable={clearWorkspaceEnable}
                  workspaceEnabledForId={workspaceEnabledForId}
                />
              ))}
            </>
          )}
        </div>
      ) : null}

      {tab === 'add' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
            <p className="m-0 text-xs font-medium text-fg">Add any MCP</p>
            <p className="m-0 text-[11px] text-secondary">
              Paste a GitHub URL, npm package, npx/uvx command, remote MCP URL, or Cursor/Claude
              mcpServers JSON. Vyotiq detects how to run it and connects tools to the agent.
            </p>
            <textarea
              className="min-h-[72px] w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg"
              aria-label="Paste MCP URL, command, or JSON"
              placeholder="https://github.com/…  ·  uvx code-review-graph serve  ·  @modelcontextprotocol/server-memory"
              rows={3}
              value={pasteInput}
              disabled={formLocked}
              onChange={(e) => {
                setPasteInput(e.target.value)
                setDetectResult(null)
                setEditServer(null)
              }}
            />
            <Button
              variant="subtle"
              pending={formLocked}
              disabled={formLocked || !pasteInput.trim()}
              onClick={() => {
                void (async () => {
                  const result = await detectMcp(pasteInput.trim())
                  if (!result) return
                  setDetectResult(result)
                  setEditServer(result.server ?? null)
                  setServerDirty(false)
                  setOverwriteDup(false)
                })()
              }}
            >
              Detect
            </Button>

            {detectResult ? (
              <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-bg px-2 py-2">
                <p className="m-0 text-[11px] text-secondary">
                  Kind: {detectResult.kind} · confidence: {detectResult.confidence}
                  {detectResult.duplicate ? ' · already configured' : ''}
                </p>
                {detectResult.warnings.map((w) => (
                  <p key={w} className="m-0 text-[11px] text-warning">
                    {w}
                  </p>
                ))}
                {detectResult.install && (!editServer || (detectResult.kind === 'vyotiq-package' && !serverDirty)) ? (
                  <p className="m-0 text-xs text-fg">
                    Vyotiq package detected — will install via marketplace.
                  </p>
                ) : null}
                {editServer ? (
                  <>
                    <Input
                      className="w-full text-xs"
                      aria-label="Detected MCP name"
                      placeholder="Display name"
                      value={editServer.name}
                      disabled={formLocked}
                      onChange={(e) =>
                        patchEditServer({ ...editServer, name: e.target.value })
                      }
                    />
                    {(editServer.transport === 'http' || editServer.transport === 'sse') ? (
                      <Input
                        className="w-full font-mono text-xs"
                        aria-label="Detected MCP URL"
                        placeholder="URL"
                        value={editServer.url ?? ''}
                        disabled={formLocked}
                        onChange={(e) =>
                          patchEditServer({ ...editServer, url: e.target.value })
                        }
                      />
                    ) : (
                      <>
                        <Input
                          className="w-full font-mono text-xs"
                          aria-label="Detected MCP command"
                          placeholder="Command"
                          value={editServer.command ?? ''}
                          disabled={formLocked}
                          onChange={(e) =>
                            patchEditServer({ ...editServer, command: e.target.value })
                          }
                        />
                        <textarea
                          className="min-h-[40px] w-full rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg"
                          aria-label="Detected MCP arguments"
                          placeholder="Arguments (one per line)"
                          rows={2}
                          value={(editServer.args ?? []).join('\n')}
                          disabled={formLocked}
                          onChange={(e) =>
                            patchEditServer({
                              ...editServer,
                              args: e.target.value
                                .split('\n')
                                .map((s) => s.trim())
                                .filter(Boolean)
                            })
                          }
                        />
                      </>
                    )}
                  </>
                ) : null}
                {detectResult.duplicate && !(detectResult.install && !serverDirty) ? (
                  <label className="flex items-center gap-2 text-[11px] text-secondary">
                    <input
                      type="checkbox"
                      checked={overwriteDup}
                      disabled={formLocked}
                      onChange={(e) => setOverwriteDup(e.target.checked)}
                    />
                    Overwrite existing server
                  </label>
                ) : null}
                <Button
                  variant="subtle"
                  pending={formLocked}
                  disabled={
                    formLocked ||
                    (!editServer && !detectResult.install) ||
                    (detectResult.duplicate &&
                      !overwriteDup &&
                      !(detectResult.install && detectResult.kind === 'vyotiq-package' && !serverDirty)) ||
                    (Boolean(editServer) &&
                      !(editServer?.command ?? '').trim() &&
                      !(editServer?.url ?? '').trim() &&
                      !(
                        detectResult.install &&
                        detectResult.kind === 'vyotiq-package' &&
                        !serverDirty
                      ))
                  }
                  onClick={() => {
                    void (async () => {
                      const preferInstall =
                        Boolean(detectResult.install) &&
                        (detectResult.kind === 'vyotiq-package'
                          ? !serverDirty
                          : !editServer)
                      const ok = await applyDetectedMcp(
                        preferInstall && detectResult.install
                          ? { install: detectResult.install, overwrite: false }
                          : {
                              server: editServer ?? undefined,
                              overwrite: overwriteDup
                            }
                      )
                      if (ok) {
                        setPasteInput('')
                        setDetectResult(null)
                        setEditServer(null)
                        setServerDirty(false)
                        setTab('installed')
                      }
                    })()
                  }}
                >
                  Add & connect
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
            <p className="m-0 text-xs font-medium text-fg">Import from Cursor / Claude</p>
            <p className="m-0 text-[11px] text-secondary">
              Scan local mcp.json / Claude Desktop configs and import selected servers.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="subtle"
                pending={formLocked}
                disabled={formLocked}
                onClick={() => {
                  void (async () => {
                    const scanned = await scanExternalMcp()
                    if (!scanned) return
                    setImportPreview(scanned.preview)
                    setImportSelected(new Set(scanned.preview.map((s) => s.id)))
                    setImportWarnings(scanned.warnings)
                    if (scanned.preview.length === 0) {
                      setFeedback({
                        kind: 'error',
                        text:
                          scanned.warnings[0] ??
                          'No MCP servers found in default Cursor/Claude config paths.'
                      })
                    }
                  })()
                }}
              >
                Scan defaults
              </Button>
              <Button
                variant="subtle"
                pending={formLocked}
                disabled={formLocked}
                onClick={() => {
                  void (async () => {
                    const pick = await window.vyotiq.marketplacePickLocal()
                    if (!pick.ok) {
                      setFeedback({ kind: 'error', text: pick.error })
                      return
                    }
                    if (!pick.data) return
                    const scanned = await scanExternalMcp([pick.data])
                    if (!scanned) return
                    setImportPreview(scanned.preview)
                    setImportSelected(new Set(scanned.preview.map((s) => s.id)))
                    setImportWarnings(scanned.warnings)
                    if (scanned.preview.length === 0) {
                      setFeedback({
                        kind: 'error',
                        text: scanned.warnings[0] ?? 'No MCP servers found in that file.'
                      })
                    }
                  })()
                }}
              >
                Choose config file…
              </Button>
            </div>
            {importWarnings.length > 0 ? (
              <div className="flex flex-col gap-1">
                {importWarnings.map((w) => (
                  <p key={w} className="m-0 text-[11px] text-warning">
                    {w}
                  </p>
                ))}
              </div>
            ) : null}
            {importPreview && importPreview.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {importPreview.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-start gap-2 text-[11px] text-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={importSelected.has(s.id)}
                      disabled={formLocked}
                      onChange={(e) => {
                        setImportSelected((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(s.id)
                          else next.delete(s.id)
                          return next
                        })
                      }}
                    />
                    <span>
                      <span className="text-fg">{s.name}</span>
                      {' · '}
                      {s.transport === 'stdio'
                        ? `${s.command ?? ''} ${(s.args ?? []).join(' ')}`.trim()
                        : s.url}
                    </span>
                  </label>
                ))}
                <Button
                  variant="subtle"
                  pending={formLocked}
                  disabled={formLocked || importSelected.size === 0}
                  onClick={() => {
                    void (async () => {
                      const selected = importPreview.filter((s) => importSelected.has(s.id))
                      const ok = await importExternalMcp({
                        mode: 'merge',
                        selectedIds: [...importSelected],
                        servers: selected
                      })
                      if (ok) {
                        setImportPreview(null)
                        setImportSelected(new Set())
                        setImportWarnings([])
                        setTab('installed')
                      }
                    })()
                  }}
                >
                  Import selected
                </Button>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="m-0 self-start text-xs text-secondary underline-offset-2 hover:text-fg hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide advanced' : 'Show advanced'}
          </button>

          {showAdvanced ? (
            <>
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
            <p className="m-0 text-xs font-medium text-fg">Stdio MCP</p>
            <p className="m-0 text-[11px] text-secondary">
              Run a local MCP server via command (e.g. npx). Added enabled by default.
            </p>
            <Input
              className="w-full text-xs"
              aria-label="Stdio MCP display name"
              placeholder="Display name"
              value={stdioName}
              disabled={formLocked}
              onChange={(e) => setStdioName(e.target.value)}
            />
            <Input
              className="w-full font-mono text-xs"
              aria-label="Stdio MCP command"
              placeholder="Command (e.g. npx)"
              value={stdioCommand}
              disabled={formLocked}
              onChange={(e) => setStdioCommand(e.target.value)}
            />
            <textarea
              className="min-h-[52px] w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg"
              aria-label="Stdio MCP arguments"
              placeholder="Arguments (one per line)"
              rows={3}
              value={stdioArgs}
              disabled={formLocked}
              onChange={(e) => setStdioArgs(e.target.value)}
            />
            <Button
              variant="subtle"
              disabled={formLocked || !stdioCommand.trim()}
              onClick={() => void addStdioMcp()}
            >
              Add stdio MCP
            </Button>
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
            <p className="m-0 text-xs font-medium text-fg">Remote MCP (HTTP / SSE)</p>
            <p className="m-0 text-[11px] text-secondary">
              Paste a streamable HTTP or SSE MCP endpoint. Auth (Bearer / OAuth) under Installed.
            </p>
            <Input
              className="w-full font-mono text-xs"
              aria-label="Remote MCP URL"
              placeholder="https://mcp.example.com/mcp"
              value={remoteUrl}
              disabled={formLocked}
              onChange={(e) => setRemoteUrl(e.target.value)}
            />
            <Input
              className="w-full text-xs"
              aria-label="Remote MCP display name"
              placeholder="Display name (optional)"
              value={remoteName}
              disabled={formLocked}
              onChange={(e) => setRemoteName(e.target.value)}
            />
            <select
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-xs"
              aria-label="Remote MCP transport"
              value={remoteTransport}
              disabled={formLocked}
              onChange={(e) => setRemoteTransport(e.target.value as 'http' | 'sse')}
            >
              <option value="http">http (streamable)</option>
              <option value="sse">sse</option>
            </select>
            <Input
              className="w-full font-mono text-xs"
              type="password"
              autoComplete="off"
              aria-label="Remote MCP Bearer token"
              placeholder="Bearer token (optional, OS secure storage)"
              value={remoteBearer}
              disabled={formLocked}
              onChange={(e) => setRemoteBearer(e.target.value)}
            />
            <Button
              variant="subtle"
              disabled={formLocked || !remoteUrl.trim()}
              onClick={() => {
                void (async () => {
                  if (!isValidHttpUrl(remoteUrl.trim())) {
                    setFeedback({
                      kind: 'error',
                      text: 'Enter a valid http(s) MCP URL.'
                    })
                    return
                  }
                  const ok = await runInstall({
                    source: 'remote',
                    target: remoteUrl.trim(),
                    kind: 'mcp',
                    name: remoteName.trim() || undefined,
                    transport: remoteTransport,
                    bearerToken: remoteBearer.trim() || undefined
                  })
                  if (ok) {
                    setRemoteUrl('')
                    setRemoteName('')
                    setRemoteBearer('')
                    setTab('installed')
                  }
                })()
              }}
            >
              Install remote MCP
            </Button>
          </div>

          <p className="m-0 text-xs font-medium text-fg">Local / package sources</p>
          <Button
            variant="subtle"
            disabled={formLocked}
            onClick={() => {
              void (async () => {
                const pick = await window.vyotiq.marketplacePickLocal()
                if (!pick.ok) {
                  setFeedback({ kind: 'error', text: pick.error })
                  return
                }
                if (!pick.data) return
                const path = pick.data
                const isZip = /\.(zip|tgz)$/i.test(path)
                const ok = await runInstall({
                  source: isZip ? 'zip' : 'path',
                  target: path
                })
                if (ok) setTab('installed')
              })()
            }}
          >
            Choose folder or zip…
          </Button>
          <div className="flex gap-2">
            <Input
              className="flex-1 font-mono text-xs"
              aria-label="Git clone URL"
              placeholder="git clone URL"
              value={gitUrl}
              disabled={formLocked}
              onChange={(e) => setGitUrl(e.target.value)}
            />
            <Button
              variant="subtle"
              pending={formLocked}
              disabled={formLocked || !gitUrl.trim()}
              onClick={() => {
                void (async () => {
                  const ok = await runInstall({ source: 'git', target: gitUrl.trim() })
                  if (ok) {
                    setGitUrl('')
                    setTab('installed')
                  }
                })()
              }}
            >
              Install git
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              className="flex-1 font-mono text-xs"
              aria-label="npm package name"
              placeholder="npm package name"
              value={npmName}
              disabled={formLocked}
              onChange={(e) => setNpmName(e.target.value)}
            />
            <Button
              variant="subtle"
              pending={formLocked}
              disabled={formLocked || !npmName.trim()}
              onClick={() => {
                void (async () => {
                  const ok = await runInstall({ source: 'npm', target: npmName.trim() })
                  if (ok) {
                    setNpmName('')
                    setTab('installed')
                  }
                })()
              }}
            >
              Install npm
            </Button>
          </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
