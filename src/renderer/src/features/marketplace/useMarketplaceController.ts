import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MarketplaceCatalogEntry,
  MarketplaceIndex,
  MarketplaceInstalledItem,
  MarketplaceInstallRequest,
  MarketplaceKind,
  McpServerStatus,
  Settings
} from '@shared/ipc'

export type MarketplaceFeedback = { kind: 'success' | 'error'; text: string }

const REMOTE_INSTALL_SOURCES = new Set(['registry', 'git', 'npm', 'zip', 'remote'])
const QUERY_DEBOUNCE_MS = 250

export function useMarketplaceController({
  settings,
  onUpdate
}: {
  settings: Settings
  onUpdate: (partial: Partial<Settings>) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [kindFilter, setKindFilter] = useState<MarketplaceKind | 'all'>('all')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [catalog, setCatalog] = useState<MarketplaceCatalogEntry[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [installed, setInstalled] = useState<MarketplaceIndex>({ schemaVersion: 1, items: [] })
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<MarketplaceFeedback | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([])
  const [mcpStatusLoading, setMcpStatusLoading] = useState(false)
  const mcpStatusReqIdRef = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), QUERY_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  const mcpStatusById = useMemo(() => {
    const map = new Map<string, McpServerStatus>()
    for (const row of mcpStatus) map.set(row.id, row)
    return map
  }, [mcpStatus])

  const installedIds = useMemo(() => new Set(installed.items.map((i) => i.id)), [installed.items])

  const formLocked = busy || saving

  const loadMcpStatus = useCallback(async (refresh = false): Promise<void> => {
    if (!window.vyotiq.mcpStatus) return
    const reqId = ++mcpStatusReqIdRef.current
    setMcpStatusLoading(true)
    try {
      const res =
        refresh && window.vyotiq.mcpRefresh
          ? await window.vyotiq.mcpRefresh()
          : await window.vyotiq.mcpStatus()
      if (reqId !== mcpStatusReqIdRef.current) return
      if (res.ok) setMcpStatus(res.data.servers)
    } finally {
      if (reqId === mcpStatusReqIdRef.current) setMcpStatusLoading(false)
    }
  }, [])

  const runUpdate = useCallback(
    async (partial: Partial<Settings>): Promise<boolean> => {
      setSaving(true)
      try {
        const res = await onUpdate(partial)
        if (!res.ok) {
          setFeedback({ kind: 'error', text: res.error })
          return false
        }
        return true
      } finally {
        setSaving(false)
      }
    },
    [onUpdate]
  )

  const reload = useCallback(async () => {
    setCatalogLoading(true)
    try {
      const [browseRes, installedRes] = await Promise.all([
        window.vyotiq.marketplaceBrowse(
          kindFilter === 'all'
            ? { q: debouncedQuery || undefined }
            : { kind: kindFilter, q: debouncedQuery || undefined }
        ),
        window.vyotiq.marketplaceListInstalled()
      ])
      if (browseRes.ok) setCatalog(browseRes.data.packages)
      else setFeedback({ kind: 'error', text: browseRes.error })
      if (installedRes.ok) setInstalled(installedRes.data)
      else setFeedback({ kind: 'error', text: installedRes.error })
    } finally {
      setCatalogLoading(false)
    }
  }, [kindFilter, debouncedQuery])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    void reload()
  }, [settings.marketplace?.registryUrl]) // eslint-disable-line react-hooks/exhaustive-deps -- reload on registry URL change only

  useEffect(() => {
    void loadMcpStatus()
  }, [loadMcpStatus, installed.items.length, settings.mcpServers])

  const ensureRemoteAck = useCallback(async (): Promise<boolean> => {
    if (settings.marketplace?.remoteInstallAcked) return true
    const ok = window.confirm(
      'Remote marketplace packages and MCP endpoints are unsigned. Install only from sources you trust. Continue?'
    )
    if (!ok) return false
    return runUpdate({
      marketplace: {
        ...settings.marketplace,
        registryUrl: settings.marketplace?.registryUrl ?? '',
        remoteInstallAcked: true
      }
    })
  }, [runUpdate, settings.marketplace])

  const runInstall = useCallback(
    async (payload: MarketplaceInstallRequest): Promise<boolean> => {
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
        const { item, authTokenStored } = res.data
        let tokenHint = ''
        if (payload.source === 'remote' && payload.bearerToken?.trim()) {
          tokenHint =
            authTokenStored === false
              ? ' Warning: Bearer token could not be stored in OS secure storage — configure auth under Installed.'
              : ' Bearer token stored in OS secure storage.'
        }
        setFeedback({
          kind: authTokenStored === false ? 'error' : 'success',
          text: `Installed ${item.name} (${item.kind}) — enabled by default; tools load into the agent when connected.${tokenHint}`
        })
        await reload()
        await loadMcpStatus(true)
        return true
      } finally {
        setBusy(false)
      }
    },
    [ensureRemoteAck, loadMcpStatus, reload]
  )

  const installFromCatalog = useCallback(
    async (entry: MarketplaceCatalogEntry): Promise<boolean> => {
      if (entry.installable === false) return false
      if (entry.bundledPath) {
        return runInstall({
          source: 'bundled',
          target: entry.bundledPath,
          kind: entry.kind
        })
      }
      return runInstall({
        source: 'registry',
        target: entry.id,
        kind: entry.kind
      })
    },
    [runInstall]
  )

  const setEnabled = useCallback(
    async (item: MarketplaceInstalledItem, enabled: boolean) => {
      setBusy(true)
      try {
        const res = await window.vyotiq.marketplaceSetEnabled(item.id, enabled)
        if (!res.ok) {
          setFeedback({ kind: 'error', text: res.error })
          return
        }
        setInstalled(res.data)
        if (item.kind === 'mcp' || item.kind === 'plugin') {
          await loadMcpStatus(true)
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
    },
    [loadMcpStatus]
  )

  const uninstall = useCallback(
    async (id: string) => {
      if (!window.confirm('Uninstall this package? Auth secrets for its MCP servers will be cleared.')) {
        return
      }
      setBusy(true)
      try {
        const res = await window.vyotiq.marketplaceUninstall(id)
        if (!res.ok) {
          setFeedback({ kind: 'error', text: res.error })
          return
        }
        setInstalled(res.data)
        setFeedback({ kind: 'success', text: 'Uninstalled' })
        await loadMcpStatus(true)
      } finally {
        setBusy(false)
      }
    },
    [loadMcpStatus]
  )

  return {
    kindFilter,
    setKindFilter,
    query,
    setQuery,
    catalog,
    catalogLoading,
    setCatalog,
    installed,
    installedIds,
    busy,
    formLocked,
    feedback,
    setFeedback,
    mcpStatusById,
    mcpStatusLoading,
    loadMcpStatus,
    runUpdate,
    reload,
    runInstall,
    installFromCatalog,
    setEnabled,
    uninstall
  }
}

export type MarketplaceController = ReturnType<typeof useMarketplaceController>
