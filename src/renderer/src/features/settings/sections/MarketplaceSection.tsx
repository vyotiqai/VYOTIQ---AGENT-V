import { useCallback, useEffect, useState } from 'react'
import type {
  MarketplaceCatalogEntry,
  MarketplaceIndex,
  MarketplaceInstalledItem,
  MarketplaceKind,
  McpServer,
  Settings,
  WorkspaceSettingsOverride
} from '@shared/ipc'
import { Button, Input } from '@renderer/lib/ui'
import type { SettingsFormState } from '../hooks/useSettingsForm'
import { SettingsRow } from '../components/SettingsRow'
import { McpServerCard } from '../components/McpServerCard'
import { isValidHttpUrl, mcpStatusClass, mcpStatusLabel } from '../utils/settingsHelpers'

type Tab = 'browse' | 'installed' | 'add'

type Feedback = { kind: 'success' | 'error'; text: string }

type PackageContents = {
  id: string
  kind: MarketplaceKind
  mcp: Array<{ id: string; name: string; path: string }>
  skills: Array<{ name: string; description: string; path: string }>
  rules: Array<{ path: string }>
}

function kindLabel(kind: MarketplaceKind): string {
  switch (kind) {
    case 'mcp':
      return 'MCP'
    case 'skill':
      return 'Skill'
    case 'plugin':
      return 'Plugin'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function nestedPluginMcpServerId(pluginId: string, nestedId: string): string {
  return `plugin-${pluginId}-${nestedId}`.replace(/__/g, '-')
}

function aggregateMcpStatuses(
  statuses: Array<ReturnType<SettingsFormState['mcpStatusById']['get']>>
): {
  labelStatus: ReturnType<SettingsFormState['mcpStatusById']['get']>
  toolCount: number
  errors: string[]
} {
  const defined = statuses.filter((s): s is NonNullable<typeof s> => s != null)
  if (defined.length === 0) {
    return { labelStatus: undefined, toolCount: 0, errors: [] }
  }
  const connected = defined.filter((s) => s.connected)
  const enabled = defined.some((s) => s.enabled)
  const toolCount = defined.reduce((n, s) => n + (s.toolCount ?? 0), 0)
  const errors = defined.map((s) => s.error).filter((e): e is string => Boolean(e))
  const hasAuthToken = defined.some((s) => s.hasAuthToken === true)
  const labelStatus = {
    id: defined[0]!.id,
    name: defined[0]!.name,
    enabled,
    connected: connected.length > 0,
    toolCount,
    ...(hasAuthToken ? { hasAuthToken: true } : {}),
    ...(errors[0] ? { error: errors[0] } : {})
  }
  return { labelStatus, toolCount, errors }
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

const REMOTE_INSTALL_SOURCES = new Set(['registry', 'git', 'npm', 'zip', 'remote'])

function InstalledMarketplaceItem({
  item,
  form,
  settings,
  busy,
  ws,
  linked,
  activeWorkspacePath,
  onSetSettingsOverride,
  setEnabled,
  setWorkspaceEnable,
  clearWorkspaceEnable,
  uninstall
}: {
  item: MarketplaceInstalledItem
  form: SettingsFormState
  settings: Settings
  busy: boolean
  ws: boolean | undefined
  linked: McpServer | undefined
  activeWorkspacePath?: string | null
  onSetSettingsOverride: boolean
  setEnabled: (item: MarketplaceInstalledItem, enabled: boolean) => Promise<void>
  setWorkspaceEnable: (
    kind: 'mcp' | 'skills' | 'plugins',
    id: string,
    enabled: boolean
  ) => Promise<void>
  clearWorkspaceEnable: (kind: 'mcp' | 'skills' | 'plugins', id: string) => Promise<void>
  uninstall: (id: string) => Promise<void>
}) {
  const [pluginContents, setPluginContents] = useState<PackageContents | null>(null)

  const status = (() => {
    if (item.kind === 'mcp') {
      return linked
        ? form.mcpStatusById.get(linked.id)
        : form.mcpStatusById.get(item.id)
    }
    if (item.kind === 'plugin') {
      if (!pluginContents?.mcp.length) return undefined
      const nestedStatuses = pluginContents.mcp.map((m) =>
        form.mcpStatusById.get(nestedPluginMcpServerId(item.id, m.id))
      )
      return aggregateMcpStatuses(nestedStatuses).labelStatus
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
            disabled={busy || form.formLocked}
            aria-label={`Enable ${item.name}`}
            onChange={(e) => void setEnabled(item, e.target.checked)}
          />
          Global
        </label>
      </div>
      <p className="m-0 mt-1 text-secondary">{item.description || '—'}</p>
      {showMcpStatus && !linked ? (
        <p className={`m-0 mt-1 ${mcpStatusClass(status)}`}>{mcpStatusLabel(status)}</p>
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
            disabled={busy || form.formLocked}
            hideEnable
            hideRemove
            onUpdate={async (next) => {
              const updated = settings.mcpServers.map((s) => (s.id === linked.id ? next : s))
              return form.runUpdate({ mcpServers: updated })
            }}
            onRemove={() => undefined}
            onAuthChanged={() => {
              void form.loadMcpStatus(true)
            }}
          />
        </div>
      ) : null}
      {activeWorkspacePath && onSetSettingsOverride ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-muted">This workspace:</span>
          <Button
            variant="subtle"
            disabled={busy || form.formLocked}
            aria-pressed={ws === true}
            onClick={() => void setWorkspaceEnable(overrideKind, item.id, true)}
          >
            Force on{ws === true ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={busy || form.formLocked}
            aria-pressed={ws === false}
            onClick={() => void setWorkspaceEnable(overrideKind, item.id, false)}
          >
            Force off{ws === false ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={busy || form.formLocked || ws === undefined}
            onClick={() => void clearWorkspaceEnable(overrideKind, item.id)}
          >
            Use global
          </Button>
        </div>
      ) : null}
      <Button
        variant="subtle"
        className="mt-2"
        disabled={busy || form.formLocked}
        onClick={() => void uninstall(item.id)}
      >
        Uninstall
      </Button>
    </div>
  )
}

function ManualMcpInstalledItem({
  server,
  form,
  settings,
  busy,
  ws,
  activeWorkspacePath,
  onSetSettingsOverride,
  setWorkspaceEnable,
  clearWorkspaceEnable
}: {
  server: McpServer
  form: SettingsFormState
  settings: Settings
  busy: boolean
  ws: boolean | undefined
  activeWorkspacePath?: string | null
  onSetSettingsOverride: boolean
  setWorkspaceEnable: (
    kind: 'mcp' | 'skills' | 'plugins',
    id: string,
    enabled: boolean
  ) => Promise<void>
  clearWorkspaceEnable: (kind: 'mcp' | 'skills' | 'plugins', id: string) => Promise<void>
}) {
  return (
    <>
      <McpServerCard
        server={server}
        status={form.mcpStatusById.get(server.id)}
        disabled={busy || form.formLocked}
        onUpdate={async (next) => {
          const updated = settings.mcpServers.map((s) => (s.id === server.id ? next : s))
          return form.runUpdate({ mcpServers: updated })
        }}
        onRemove={() => {
          void (async () => {
            await window.vyotiq.mcpClearAuthToken?.(server.id)
            await form.runUpdate({
              mcpServers: settings.mcpServers.filter((s) => s.id !== server.id)
            })
          })()
        }}
        onAuthChanged={() => {
          void form.loadMcpStatus(true)
        }}
      />
      {activeWorkspacePath && onSetSettingsOverride ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 px-0.5">
          <span className="text-muted text-xs">This workspace:</span>
          <Button
            variant="subtle"
            disabled={busy || form.formLocked}
            aria-pressed={ws === true}
            onClick={() => void setWorkspaceEnable('mcp', server.id, true)}
          >
            Force on{ws === true ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={busy || form.formLocked}
            aria-pressed={ws === false}
            onClick={() => void setWorkspaceEnable('mcp', server.id, false)}
          >
            Force off{ws === false ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={busy || form.formLocked || ws === undefined}
            onClick={() => void clearWorkspaceEnable('mcp', server.id)}
          >
            Use global
          </Button>
        </div>
      ) : null}
    </>
  )
}

export function MarketplaceSection({
  settings,
  form,
  activeWorkspacePath,
  settingsOverridesByPath,
  onSetSettingsOverride
}: {
  settings: Settings
  form: SettingsFormState
  activeWorkspacePath?: string | null
  settingsOverridesByPath?: Record<string, WorkspaceSettingsOverride>
  onSetSettingsOverride?: (
    path: string,
    override: WorkspaceSettingsOverride | null
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [tab, setTab] = useState<Tab>('browse')
  const [kindFilter, setKindFilter] = useState<MarketplaceKind | 'all'>('all')
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<MarketplaceCatalogEntry[]>([])
  const [installed, setInstalled] = useState<MarketplaceIndex>({ schemaVersion: 1, items: [] })
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [gitUrl, setGitUrl] = useState('')
  const [npmName, setNpmName] = useState('')
  const [registryUrl, setRegistryUrl] = useState(settings.marketplace?.registryUrl ?? '')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteName, setRemoteName] = useState('')
  const [remoteTransport, setRemoteTransport] = useState<'http' | 'sse'>('http')
  const [remoteBearer, setRemoteBearer] = useState('')
  const [stdioName, setStdioName] = useState('New MCP server')
  const [stdioCommand, setStdioCommand] = useState('npx')
  const [stdioArgs, setStdioArgs] = useState('-y\n@modelcontextprotocol/server-filesystem\n.')

  const manualServers = settings.mcpServers.filter((s) => s.source !== 'marketplace')

  const reload = useCallback(async () => {
    const [browseRes, installedRes] = await Promise.all([
      window.vyotiq.marketplaceBrowse(
        kindFilter === 'all' ? { q: query || undefined } : { kind: kindFilter, q: query || undefined }
      ),
      window.vyotiq.marketplaceListInstalled()
    ])
    if (browseRes.ok) setCatalog(browseRes.data.packages)
    if (installedRes.ok) setInstalled(installedRes.data)
  }, [kindFilter, query])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    setRegistryUrl(settings.marketplace?.registryUrl ?? '')
  }, [settings.marketplace?.registryUrl])

  useEffect(() => {
    void form.loadMcpStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when marketplace MCP set changes
  }, [installed.items.length, settings.mcpServers])

  const installedIds = new Set(installed.items.map((i) => i.id))

  const ensureRemoteAck = async (): Promise<boolean> => {
    if (settings.marketplace?.remoteInstallAcked) return true
    const ok = window.confirm(
      'Remote marketplace packages and MCP endpoints are unsigned. Install only from sources you trust. Continue?'
    )
    if (!ok) return false
    await form.runUpdate({
      marketplace: {
        ...settings.marketplace,
        registryUrl: settings.marketplace?.registryUrl ?? '',
        remoteInstallAcked: true
      }
    })
    return true
  }

  const runInstall = async (
    payload: Parameters<typeof window.vyotiq.marketplaceInstall>[0]
  ): Promise<boolean> => {
    setBusy(true)
    setFeedback(null)
    try {
      if (REMOTE_INSTALL_SOURCES.has(payload.source)) {
        const acked = await ensureRemoteAck()
        if (!acked) return false
      }
      const res = await window.vyotiq.marketplaceInstall(payload)
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error })
        return false
      }
      const tokenHint =
        payload.source === 'remote' && 'bearerToken' in payload && payload.bearerToken?.trim()
          ? ' Bearer token stored in OS secure storage.'
          : ''
      setFeedback({
        kind: 'success',
        text: `Installed ${res.data.name} (${res.data.kind}) — enabled by default; tools load into the agent when connected.${tokenHint}`
      })
      await reload()
      await form.loadMcpStatus(true)
      return true
    } finally {
      setBusy(false)
    }
  }

  const setEnabled = async (item: MarketplaceInstalledItem, enabled: boolean) => {
    setBusy(true)
    try {
      const res = await window.vyotiq.marketplaceSetEnabled(item.id, enabled)
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error })
        return
      }
      setInstalled(res.data)
      if (item.kind === 'mcp' || item.kind === 'plugin') {
        await form.loadMcpStatus(true)
        setFeedback({
          kind: 'success',
          text: enabled
            ? `${item.name} enabled — connecting and loading tools for the agent.`
            : `${item.name} disabled.`
        })
      } else {
        setFeedback({
          kind: 'success',
          text: enabled ? `${item.name} enabled.` : `${item.name} disabled.`
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const uninstall = async (id: string) => {
    setBusy(true)
    try {
      const res = await window.vyotiq.marketplaceUninstall(id)
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error })
        return
      }
      setInstalled(res.data)
      setFeedback({ kind: 'success', text: 'Uninstalled' })
      await form.loadMcpStatus(true)
    } finally {
      setBusy(false)
    }
  }

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
    const prev = workspaceOverride ?? { useOverride: true }
    const marketplaceOverrides = {
      ...(prev.marketplaceOverrides ?? {}),
      [kind]: {
        ...(prev.marketplaceOverrides?.[kind] ?? {}),
        [id]: enabled
      }
    }
    await onSetSettingsOverride(activeWorkspacePath, {
      ...prev,
      useOverride: true,
      marketplaceOverrides
    })
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
    await onSetSettingsOverride(activeWorkspacePath, {
      ...workspaceOverride,
      useOverride: true,
      marketplaceOverrides
    })
  }

  const workspaceEnabledForId = (kind: 'mcp' | 'skills' | 'plugins', id: string): boolean | undefined => {
    if (!workspaceOverride?.useOverride) return undefined
    const map = workspaceOverride.marketplaceOverrides?.[kind]
    if (map && Object.prototype.hasOwnProperty.call(map, id)) return map[id]
    return undefined
  }

  const workspaceEnabled = (
    item: MarketplaceInstalledItem
  ): boolean | undefined => {
    const kind =
      item.kind === 'mcp' ? 'mcp' : item.kind === 'skill' ? 'skills' : 'plugins'
    return workspaceEnabledForId(kind, item.id)
  }

  const mcpServerForPackage = (item: MarketplaceInstalledItem) => {
    return settings.mcpServers.find(
      (s) => s.source === 'marketplace' && (s.packageId === item.id || s.id === item.id)
    )
  }

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
    setBusy(true)
    try {
      const ok = await form.runUpdate({ mcpServers: [...settings.mcpServers, next] })
      if (ok) {
        setFeedback({ kind: 'success', text: `Added MCP server "${next.name}"` })
        setTab('installed')
        setStdioName('New MCP server')
        setStdioCommand('npx')
        setStdioArgs('-y\n@modelcontextprotocol/server-filesystem\n.')
        await form.loadMcpStatus(true)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {activeWorkspacePath && onSetSettingsOverride ? (
        <p className="m-0 mb-3 rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-secondary">
          Workspace overrides are available below. Force on/off applies only while this workspace’s
          override is active (General → Workspaces).
        </p>
      ) : null}

      <SettingsRow
        stacked
        title="Packages & MCP"
        description="Browse, install, and configure MCP servers (stdio / HTTP / SSE), skills, and plugins. Enabled servers connect automatically and their tools load into the agent. Unsigned packages — install only from sources you trust."
      >
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            {(['browse', 'installed', 'add'] as Tab[]).map((t) => (
              <Button
                key={t}
                variant={tab === t ? 'primary' : 'subtle'}
                disabled={form.formLocked || busy}
                onClick={() => setTab(t)}
              >
                {t === 'browse' ? 'Browse' : t === 'installed' ? 'Installed' : 'Add'}
              </Button>
            ))}
          </div>

          {tab === 'browse' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="marketplace-registry-url" className="text-xs text-secondary">
                Registry URL (optional)
              </label>
              <div className="flex gap-2">
                <Input
                  id="marketplace-registry-url"
                  className="w-full font-mono text-xs"
                  value={registryUrl}
                  disabled={form.formLocked || busy}
                  placeholder="https://registry.example.com"
                  onChange={(e) => setRegistryUrl(e.target.value)}
                  onBlur={() => {
                    void form.runUpdate({
                      marketplace: {
                        registryUrl: registryUrl.trim(),
                        remoteInstallAcked: settings.marketplace?.remoteInstallAcked ?? false
                      }
                    })
                  }}
                />
                <Button
                  variant="subtle"
                  disabled={form.formLocked || busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true)
                      try {
                        await form.runUpdate({
                          marketplace: {
                            registryUrl: registryUrl.trim(),
                            remoteInstallAcked: settings.marketplace?.remoteInstallAcked ?? false
                          }
                        })
                        const res = await window.vyotiq.marketplaceRefreshCatalog()
                        if (res.ok) {
                          setCatalog(res.data.packages)
                          setFeedback({
                            kind: 'success',
                            text: `Catalog refreshed (${res.data.packages.length} packages)`
                          })
                        } else setFeedback({ kind: 'error', text: res.error })
                      } finally {
                        setBusy(false)
                      }
                    })()
                  }}
                >
                  Refresh
                </Button>
              </div>
            </div>
          ) : null}

          {feedback ? (
            <p
              className={`m-0 text-xs [overflow-wrap:anywhere] ${
                feedback.kind === 'error' ? 'text-danger' : 'text-secondary'
              }`}
              role={feedback.kind === 'error' ? 'alert' : 'status'}
            >
              {feedback.text}
            </p>
          ) : null}

          {tab === 'browse' ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  value={kindFilter}
                  disabled={busy}
                  aria-label="Filter by kind"
                  onChange={(e) => setKindFilter(e.target.value as MarketplaceKind | 'all')}
                >
                  <option value="all">All</option>
                  <option value="mcp">MCP</option>
                  <option value="skill">Skills</option>
                  <option value="plugin">Plugins</option>
                </select>
                <Input
                  className="min-w-[160px] flex-1"
                  placeholder="Search"
                  value={query}
                  disabled={busy}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {catalog.length === 0 ? (
                <p className="m-0 text-xs text-muted">
                  No packages in catalog. Use Add → Remote MCP for HTTP/SSE endpoints, or set a
                  registry URL and Refresh.
                </p>
              ) : (
                <>
                  <p className="m-0 text-[11px] text-secondary">
                    For remote HTTP/SSE MCP servers, use Add → Remote MCP (URL + optional Bearer
                    token). Enable installed MCP packages to connect and load tools into the agent.
                  </p>
                  {catalog.map((entry) => (
                  <div
                    key={`${entry.source}-${entry.id}`}
                    className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="m-0 font-medium text-fg">
                          {entry.name}{' '}
                          <span className="text-muted">
                            ({kindLabel(entry.kind)} · {entry.source})
                          </span>
                        </p>
                        <p className="m-0 mt-1 text-secondary">{entry.description || '—'}</p>
                        <p className="m-0 mt-1 text-muted">
                          {entry.id}@{entry.version}
                        </p>
                      </div>
                      <Button
                        variant="subtle"
                        disabled={busy || form.formLocked || installedIds.has(entry.id)}
                        onClick={() => {
                          void runInstall(
                            entry.source === 'bundled' && entry.bundledPath
                              ? { source: 'bundled', target: entry.bundledPath, kind: entry.kind }
                              : { source: 'registry', target: entry.id, kind: entry.kind }
                          )
                        }}
                      >
                        {installedIds.has(entry.id) ? 'Installed' : 'Install'}
                      </Button>
                    </div>
                  </div>
                  ))}
                </>
              )}
            </div>
          ) : null}

          {tab === 'installed' ? (
            <div className="flex flex-col gap-2">
              <div className="flex justify-end">
                <Button
                  variant="subtle"
                  disabled={form.formLocked || form.mcpStatusLoading || busy}
                  onClick={() => void form.loadMcpStatus(true)}
                >
                  {form.mcpStatusLoading ? 'Refreshing…' : 'Refresh MCP connections'}
                </Button>
              </div>
              {manualServers.length === 0 && installed.items.length === 0 ? (
                <p className="m-0 text-xs text-muted">
                  Nothing installed yet. Use Add to configure a stdio or remote MCP, or Browse
                  for packages.
                </p>
              ) : (
                <>
                  {manualServers.map((server) => (
                    <ManualMcpInstalledItem
                      key={server.id}
                      server={server}
                      form={form}
                      settings={settings}
                      busy={busy}
                      ws={workspaceEnabledForId('mcp', server.id)}
                      activeWorkspacePath={activeWorkspacePath}
                      onSetSettingsOverride={!!onSetSettingsOverride}
                      setWorkspaceEnable={setWorkspaceEnable}
                      clearWorkspaceEnable={clearWorkspaceEnable}
                    />
                  ))}
                  {installed.items.map((item) => (
                    <InstalledMarketplaceItem
                      key={item.id}
                      item={item}
                      form={form}
                      settings={settings}
                      busy={busy}
                      ws={workspaceEnabled(item)}
                      linked={item.kind === 'mcp' ? mcpServerForPackage(item) : undefined}
                      activeWorkspacePath={activeWorkspacePath}
                      onSetSettingsOverride={!!onSetSettingsOverride}
                      setEnabled={setEnabled}
                      setWorkspaceEnable={setWorkspaceEnable}
                      clearWorkspaceEnable={clearWorkspaceEnable}
                      uninstall={uninstall}
                    />
                  ))}
                </>
              )}
            </div>
          ) : null}

          {tab === 'add' ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
                <p className="m-0 text-xs font-medium text-fg">Stdio MCP</p>
                <p className="m-0 text-[11px] text-secondary">
                  Run a local MCP server via command (e.g. npx). Added enabled by default — disable
                  under Installed to stop loading tools.
                </p>
                <Input
                  className="w-full text-xs"
                  aria-label="Stdio MCP display name"
                  placeholder="Display name"
                  value={stdioName}
                  disabled={busy}
                  onChange={(e) => setStdioName(e.target.value)}
                />
                <Input
                  className="w-full font-mono text-xs"
                  aria-label="Stdio MCP command"
                  placeholder="Command (e.g. npx)"
                  value={stdioCommand}
                  disabled={busy}
                  onChange={(e) => setStdioCommand(e.target.value)}
                />
                <textarea
                  className="min-h-[52px] w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg"
                  aria-label="Stdio MCP arguments"
                  placeholder="Arguments (one per line)"
                  rows={3}
                  value={stdioArgs}
                  disabled={busy}
                  onChange={(e) => setStdioArgs(e.target.value)}
                />
                <Button
                  variant="subtle"
                  disabled={busy || form.formLocked || !stdioCommand.trim()}
                  onClick={() => void addStdioMcp()}
                >
                  Add stdio MCP
                </Button>
              </div>

              <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
                <p className="m-0 text-xs font-medium text-fg">Remote MCP (HTTP / SSE)</p>
                <p className="m-0 text-[11px] text-secondary">
                  Paste a streamable HTTP or SSE MCP endpoint. Installed enabled by default; connect
                  and auth (Bearer / OAuth) under Installed.
                </p>
                <Input
                  className="w-full font-mono text-xs"
                  aria-label="Remote MCP URL"
                  placeholder="https://mcp.example.com/mcp"
                  value={remoteUrl}
                  disabled={busy}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                />
                <Input
                  className="w-full text-xs"
                  aria-label="Remote MCP display name"
                  placeholder="Display name (optional)"
                  value={remoteName}
                  disabled={busy}
                  onChange={(e) => setRemoteName(e.target.value)}
                />
                <select
                  className="rounded-md border border-border bg-bg px-2 py-1.5 text-xs"
                  aria-label="Remote MCP transport"
                  value={remoteTransport}
                  disabled={busy}
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
                  disabled={busy}
                  onChange={(e) => setRemoteBearer(e.target.value)}
                />
                <Button
                  variant="subtle"
                  disabled={busy || form.formLocked || !remoteUrl.trim()}
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
                disabled={busy || form.formLocked}
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
                    await runInstall({
                      source: isZip ? 'zip' : 'path',
                      target: path
                    })
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
                  disabled={busy}
                  onChange={(e) => setGitUrl(e.target.value)}
                />
                <Button
                  variant="subtle"
                  disabled={busy || form.formLocked || !gitUrl.trim()}
                  onClick={() => void runInstall({ source: 'git', target: gitUrl.trim() })}
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
                  disabled={busy}
                  onChange={(e) => setNpmName(e.target.value)}
                />
                <Button
                  variant="subtle"
                  disabled={busy || form.formLocked || !npmName.trim()}
                  onClick={() => void runInstall({ source: 'npm', target: npmName.trim() })}
                >
                  Install npm
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SettingsRow>
    </>
  )
}
