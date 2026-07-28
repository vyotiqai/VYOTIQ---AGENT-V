import { useCallback, useEffect, useState } from 'react'
import type {
  MarketplaceCatalogEntry,
  MarketplaceIndex,
  MarketplaceInstalledItem,
  MarketplaceKind,
  Settings,
  WorkspaceSettingsOverride
} from '@shared/ipc'
import { Button, Input, Textarea } from '@renderer/lib/ui'
import type { SettingsFormState } from '../hooks/useSettingsForm'
import { SettingsRow } from '../components/SettingsRow'
import { mcpStatusClass, mcpStatusLabel } from '../utils/settingsHelpers'
import {
  formatMcpToolNameList,
  parseMcpToolNameList
} from '@shared/utils/mcpToolPolicy'

type Tab = 'browse' | 'installed' | 'add'

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

function MarketplaceRemoteAuth({
  serverId,
  hasStoredToken,
  disabled
}: {
  serverId: string
  hasStoredToken: boolean
  disabled?: boolean
}) {
  const [token, setToken] = useState('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [oauthBusy, setOauthBusy] = useState(false)

  const commit = (): void => {
    if (!dirty) return
    const trimmed = token.trim()
    void (async () => {
      setError(null)
      if (!trimmed) {
        if (hasStoredToken) {
          const res = await window.vyotiq.mcpClearAuthToken?.(serverId)
          if (!res?.ok) {
            setError(res?.error ?? 'Could not clear auth token')
            return
          }
        }
        setDirty(false)
        return
      }
      const res = await window.vyotiq.mcpSetAuthToken?.(serverId, trimmed)
      if (!res?.ok) {
        setError(res?.error ?? 'Could not store auth token securely')
        return
      }
      setToken('')
      setDirty(false)
    })()
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <Input
        className="w-full font-mono text-xs"
        type="password"
        autoComplete="off"
        aria-label={`Bearer token for ${serverId}`}
        placeholder={
          hasStoredToken
            ? 'Bearer stored securely — enter new value to replace'
            : 'Bearer token (optional)'
        }
        disabled={disabled}
        value={token}
        onChange={(e) => {
          setToken(e.target.value)
          setDirty(true)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <Button
        variant="subtle"
        disabled={disabled || oauthBusy}
        onClick={() => {
          void (async () => {
            setOauthBusy(true)
            setError(null)
            try {
              const res = await window.vyotiq.mcpStartOAuth?.(serverId)
              if (!res?.ok) setError(res?.error ?? 'OAuth sign-in failed')
            } finally {
              setOauthBusy(false)
            }
          })()
        }}
      >
        {oauthBusy ? 'Waiting for browser…' : 'Sign in with OAuth'}
      </Button>
      {hasStoredToken ? (
        <p className="m-0 text-[11px] text-secondary">Token in OS secure storage.</p>
      ) : null}
      {error ? (
        <p className="m-0 text-[11px] text-danger [overflow-wrap:anywhere]">{error}</p>
      ) : null}
    </div>
  )
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
  linked: Settings['mcpServers'][number] | undefined
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

  const remoteAuthServerId =
    item.kind === 'mcp' && linked && (linked.transport === 'http' || linked.transport === 'sse')
      ? linked.id
      : null

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
      {linked ? (
        <p className="m-0 mt-1 font-mono text-muted">
          {(linked.transport ?? 'stdio') === 'stdio'
            ? `stdio · ${linked.command ?? ''}`
            : `${linked.transport} · ${linked.url ?? ''}`}
        </p>
      ) : null}
      {showMcpStatus ? (
        <p className={`m-0 mt-1 ${mcpStatusClass(status)}`}>
          {mcpStatusLabel(status)}
          {status?.toolCount != null && status.connected ? ` · ${status.toolCount} tools` : ''}
        </p>
      ) : null}
      {status?.error ? (
        <p className="m-0 mt-1 text-danger [overflow-wrap:anywhere]">{status.error}</p>
      ) : null}
      <InstalledPackageContents
        itemId={item.id}
        onContents={item.kind === 'plugin' ? setPluginContents : undefined}
      />
      {remoteAuthServerId ? (
        <MarketplaceRemoteAuth
          serverId={remoteAuthServerId}
          hasStoredToken={status?.hasAuthToken === true}
          disabled={busy || form.formLocked}
        />
      ) : null}
      {linked && item.kind === 'mcp' ? (
        <MarketplaceToolPolicy
          server={linked}
          disabled={busy || form.formLocked}
          onUpdate={async (next) => {
            const updated = settings.mcpServers.map((s) => (s.id === linked.id ? next : s))
            return form.runUpdate({ mcpServers: updated })
          }}
        />
      ) : null}
      {activeWorkspacePath && onSetSettingsOverride ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-muted">This workspace:</span>
          <Button
            variant="subtle"
            disabled={busy}
            onClick={() => void setWorkspaceEnable(overrideKind, item.id, true)}
          >
            Force on{ws === true ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={busy}
            onClick={() => void setWorkspaceEnable(overrideKind, item.id, false)}
          >
            Force off{ws === false ? ' ✓' : ''}
          </Button>
          <Button
            variant="subtle"
            disabled={busy || ws === undefined}
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

function MarketplaceToolPolicy({
  server,
  disabled,
  onUpdate
}: {
  server: Settings['mcpServers'][number]
  disabled?: boolean
  onUpdate: (next: Settings['mcpServers'][number]) => Promise<boolean>
}) {
  const [allowedText, setAllowedText] = useState(() =>
    formatMcpToolNameList(server.allowedTools)
  )
  const [deniedText, setDeniedText] = useState(() => formatMcpToolNameList(server.deniedTools))

  useEffect(() => {
    setAllowedText(formatMcpToolNameList(server.allowedTools))
    setDeniedText(formatMcpToolNameList(server.deniedTools))
  }, [server.id, server.allowedTools, server.deniedTools])

  return (
    <div className="mt-2 flex flex-col gap-1">
      <Textarea
        className="min-h-[36px] font-mono text-xs"
        aria-label={`Allowed tools for ${server.id}`}
        placeholder="Allow tools only (bare names). Empty = all."
        disabled={disabled}
        rows={2}
        value={allowedText}
        onChange={(e) => setAllowedText(e.target.value)}
        onBlur={() => {
          const next = parseMcpToolNameList(allowedText)
          const prevKey = (server.allowedTools ?? []).join('\n')
          const nextKey = (next ?? []).join('\n')
          if (prevKey === nextKey) return
          void onUpdate({ ...server, allowedTools: next })
        }}
      />
      <Textarea
        className="min-h-[36px] font-mono text-xs"
        aria-label={`Denied tools for ${server.id}`}
        placeholder="Deny tools (bare names)"
        disabled={disabled}
        rows={2}
        value={deniedText}
        onChange={(e) => setDeniedText(e.target.value)}
        onBlur={() => {
          const next = parseMcpToolNameList(deniedText)
          const prevKey = (server.deniedTools ?? []).join('\n')
          const nextKey = (next ?? []).join('\n')
          if (prevKey === nextKey) return
          void onUpdate({ ...server, deniedTools: next })
        }}
      />
    </div>
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
  const [message, setMessage] = useState<string | null>(null)
  const [gitUrl, setGitUrl] = useState('')
  const [npmName, setNpmName] = useState('')
  const [registryUrl, setRegistryUrl] = useState(settings.marketplace?.registryUrl ?? '')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteName, setRemoteName] = useState('')
  const [remoteTransport, setRemoteTransport] = useState<'http' | 'sse'>('http')
  const [remoteBearer, setRemoteBearer] = useState('')

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
    // Refresh connection labels when installed set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMcpStatus is stable enough via form identity
  }, [installed.items.length])

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

  const runInstall = async (payload: Parameters<typeof window.vyotiq.marketplaceInstall>[0]) => {
    setBusy(true)
    setMessage(null)
    try {
      if (REMOTE_INSTALL_SOURCES.has(payload.source)) {
        const acked = await ensureRemoteAck()
        if (!acked) return
      }
      const res = await window.vyotiq.marketplaceInstall(payload)
      if (!res.ok) {
        setMessage(res.error)
        return
      }
      setMessage(`Installed ${res.data.name} (${res.data.kind}) — enable it to load tools into the agent.`)
      await reload()
      await form.loadMcpStatus(true)
    } finally {
      setBusy(false)
    }
  }

  const setEnabled = async (item: MarketplaceInstalledItem, enabled: boolean) => {
    setBusy(true)
    try {
      const res = await window.vyotiq.marketplaceSetEnabled(item.id, enabled)
      if (!res.ok) {
        setMessage(res.error)
        return
      }
      setInstalled(res.data)
      if (item.kind === 'mcp' || item.kind === 'plugin') {
        await form.loadMcpStatus(true)
        setMessage(
          enabled
            ? `${item.name} enabled — connecting and loading tools for the agent.`
            : `${item.name} disabled.`
        )
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
        setMessage(res.error)
        return
      }
      setInstalled(res.data)
      setMessage('Uninstalled')
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

  const workspaceEnabled = (
    item: MarketplaceInstalledItem
  ): boolean | undefined => {
    if (!workspaceOverride?.useOverride) return undefined
    const map =
      item.kind === 'mcp'
        ? workspaceOverride.marketplaceOverrides?.mcp
        : item.kind === 'skill'
          ? workspaceOverride.marketplaceOverrides?.skills
          : workspaceOverride.marketplaceOverrides?.plugins
    if (map && Object.prototype.hasOwnProperty.call(map, item.id)) return map[item.id]
    return undefined
  }

  const mcpServerForPackage = (item: MarketplaceInstalledItem) => {
    return settings.mcpServers.find(
      (s) => s.source === 'marketplace' && (s.packageId === item.id || s.id === item.id)
    )
  }

  return (
    <>
      <SettingsRow
        stacked
        title="Marketplace"
        description="Browse and install Vyotiq MCP servers (stdio or remote HTTP/SSE), skills, and plugins. Enabled MCP servers connect automatically and their tools load into the agent. Unsigned packages — install only from sources you trust."
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

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-secondary">Registry URL (optional)</label>
            <div className="flex gap-2">
              <Input
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
                        setMessage(`Catalog refreshed (${res.data.packages.length} packages)`)
                      } else setMessage(res.error)
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

          {message ? <p className="m-0 text-xs text-secondary [overflow-wrap:anywhere]">{message}</p> : null}

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
              {installed.items.length === 0 ? (
                <p className="m-0 text-xs text-muted">Nothing installed yet.</p>
              ) : (
                installed.items.map((item) => (
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
                ))
              )}
            </div>
          ) : null}

          {tab === 'add' ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
                <p className="m-0 text-xs font-medium text-fg">Remote MCP (HTTP / SSE)</p>
                <p className="m-0 text-[11px] text-secondary">
                  Paste a streamable HTTP or SSE MCP endpoint. When enabled, Vyotiq connects
                  locally and loads its tools into the agent automatically.
                </p>
                <Input
                  className="w-full font-mono text-xs"
                  placeholder="https://mcp.example.com/mcp"
                  value={remoteUrl}
                  disabled={busy}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                />
                <Input
                  className="w-full text-xs"
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
                  placeholder="Bearer token (optional)"
                  value={remoteBearer}
                  disabled={busy}
                  onChange={(e) => setRemoteBearer(e.target.value)}
                />
                <Button
                  variant="subtle"
                  disabled={busy || form.formLocked || !remoteUrl.trim()}
                  onClick={() => {
                    void runInstall({
                      source: 'remote',
                      target: remoteUrl.trim(),
                      kind: 'mcp',
                      name: remoteName.trim() || undefined,
                      transport: remoteTransport,
                      bearerToken: remoteBearer.trim() || undefined
                    }).then(() => {
                      setRemoteUrl('')
                      setRemoteName('')
                      setRemoteBearer('')
                    })
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
                    if (!pick.ok || !pick.data) return
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
                  placeholder="git clone URL"
                  value={gitUrl}
                  disabled={busy}
                  onChange={(e) => setGitUrl(e.target.value)}
                />
                <Button
                  variant="subtle"
                  disabled={busy || !gitUrl.trim()}
                  onClick={() => void runInstall({ source: 'git', target: gitUrl.trim() })}
                >
                  Install git
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  className="flex-1 font-mono text-xs"
                  placeholder="npm package name"
                  value={npmName}
                  disabled={busy}
                  onChange={(e) => setNpmName(e.target.value)}
                />
                <Button
                  variant="subtle"
                  disabled={busy || !npmName.trim()}
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
