import { useEffect, useMemo, useState, type ReactNode, type Ref } from 'react'
import {
  SECRET_PROVIDERS,
  type McpServer,
  type McpServerStatus,
  type ProviderId,
  type SecretProvider,
  type Settings,
  type ThemeId,
  type WorkspaceSettingsOverride
} from '@shared/ipc'
import type { EffectiveChatSettings } from '@shared/effectiveSettings'
import {
  PROVIDER_DEFAULTS,
  defaultModelFor,
  providerLabel,
  normalizeOllamaHost
} from '@shared/providers'
import { Icon } from '@renderer/lib/icons'
import { Input, Textarea, Button, Menu, Alert, AlertBlock, NavItem, cn } from '@renderer/lib/ui'
import { formatWorkspaceName } from '@renderer/lib/utils/formatWorkspaceName'
import { useEscapeToClose } from '@renderer/lib/hooks/useEscapeToClose'
import { useModelCatalog } from '@renderer/lib/hooks/useModelCatalog'

type SettingsSection = 'general' | 'providers' | 'agent' | 'advanced'
type SettingsErrorField =
  | 'ollama'
  | 'apikey'
  | 'maxSteps'
  | 'compaction'
  | 'keepTurns'
  | null

function SettingsRow({
  title,
  description,
  children,
  stacked
}: {
  title: string
  description?: string
  children: ReactNode
  stacked?: boolean
}) {
  if (stacked) {
    return (
      <div className="border-b border-border px-0 py-3">
        <p className="m-0 text-sm tracking-[var(--vy-tracking)] text-fg-strong">{title}</p>
        {description ? (
          <p className="m-0 mt-0.5 text-xs leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]">
            {description}
          </p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">{children}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-stretch gap-2.5 border-b border-border px-0 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm tracking-[var(--vy-tracking)] text-fg-strong">{title}</p>
        {description ? (
          <p className="m-0 mt-0.5 text-xs leading-snug tracking-[var(--vy-tracking)] text-secondary [overflow-wrap:anywhere]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{children}</div>
    </div>
  )
}

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
]

const ACTIVE_PROVIDER_OPTIONS = PROVIDER_DEFAULTS.map((p) => ({
  value: p.id,
  label: p.label
}))

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function workspaceShort(path: string | null): string {
  return formatWorkspaceName(path)
}

function defaultKeyProvider(
  settingsProvider: Settings['provider'],
  secrets: Record<SecretProvider, boolean>
): SecretProvider {
  if (settingsProvider !== 'ollama') return settingsProvider
  const withKey = SECRET_PROVIDERS.find((p) => secrets[p])
  if (withKey) return withKey
  const missing = SECRET_PROVIDERS.find((p) => !secrets[p])
  return missing ?? SECRET_PROVIDERS[0]
}

function mcpStatusLabel(status: McpServerStatus | undefined): string {
  if (!status || !status.enabled) return 'Disabled'
  if (status.connected) {
    const n = status.toolCount
    return `Connected · ${n} tool${n === 1 ? '' : 's'}`
  }
  if (status.error) return 'Connection failed'
  return 'Not connected'
}

function mcpStatusClass(status: McpServerStatus | undefined): string {
  if (!status || !status.enabled) return 'text-secondary'
  if (status.connected) return 'text-success'
  if (status.error) return 'text-danger'
  return 'text-secondary'
}

function mcpArgsToText(args: string[] | undefined): string {
  return (args ?? []).join('\n')
}

function mcpTextToArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function mcpEnvToText(env: Record<string, string> | undefined): string {
  if (!env) return ''
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function mcpTextToEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (key) env[key] = value
  }
  return Object.keys(env).length > 0 ? env : undefined
}

function McpServerCard({
  server,
  status,
  disabled,
  onUpdate,
  onRemove
}: {
  server: McpServer
  status: McpServerStatus | undefined
  disabled?: boolean
  onUpdate: (next: McpServer) => Promise<boolean>
  onRemove: () => void
}) {
  const [name, setName] = useState(server.name)
  const [command, setCommand] = useState(server.command)
  const [argsText, setArgsText] = useState(mcpArgsToText(server.args))
  const [envText, setEnvText] = useState(mcpEnvToText(server.env))

  useEffect(() => {
    setName(server.name)
    setCommand(server.command)
    setArgsText(mcpArgsToText(server.args))
    setEnvText(mcpEnvToText(server.env))
  }, [server.id, server.name, server.command, server.args, server.env])

  const persist = async (patch: Partial<McpServer>): Promise<void> => {
    const next: McpServer = { ...server, ...patch }
    const ok = await onUpdate(next)
    if (!ok) {
      setName(server.name)
      setCommand(server.command)
      setArgsText(mcpArgsToText(server.args))
      setEnvText(mcpEnvToText(server.env))
    }
  }

  const commitName = (): void => {
    const trimmed = name.trim()
    if (!trimmed) {
      setName(server.name)
      return
    }
    if (trimmed !== server.name) void persist({ name: trimmed })
  }

  const commitCommand = (): void => {
    const trimmed = command.trim()
    if (!trimmed) {
      setCommand(server.command)
      return
    }
    if (trimmed !== server.command) void persist({ command: trimmed })
  }

  const commitArgs = (): void => {
    const nextArgs = mcpTextToArgs(argsText)
    const prevArgs = server.args ?? []
    if (nextArgs.join('\n') === prevArgs.join('\n')) return
    void persist({ args: nextArgs.length > 0 ? nextArgs : undefined })
  }

  const commitEnv = (): void => {
    const nextEnv = mcpTextToEnv(envText)
    const prevEnv = server.env ?? {}
    const prevText = Object.entries(prevEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
    const nextText = nextEnv
      ? Object.entries(nextEnv)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')
      : ''
    if (nextText === prevText) return
    void persist({ env: nextEnv })
  }

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 truncate text-secondary" title={server.id}>
          ID: {server.id}
        </p>
        <label className="inline-flex shrink-0 items-center gap-1.5 text-secondary">
          <input
            type="checkbox"
            className="size-3.5 accent-fg"
            checked={server.enabled}
            disabled={disabled}
            aria-label={`Enable MCP server ${server.name}`}
            onChange={(e) => {
              void persist({ enabled: e.target.checked })
            }}
          />
          Enabled
        </label>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <Input
          className="w-full"
          aria-label={`MCP server name for ${server.id}`}
          placeholder="Server name"
          disabled={disabled}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <Input
          className="w-full font-mono"
          aria-label={`MCP command for ${server.id}`}
          placeholder="Command (e.g. npx)"
          disabled={disabled}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onBlur={commitCommand}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <div className="rounded-md border border-border bg-surface px-2.5 py-1">
          <Textarea
            className="min-h-[52px] font-mono text-xs"
            aria-label={`MCP arguments for ${server.id}`}
            placeholder="Arguments (one per line)"
            disabled={disabled}
            rows={3}
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            onBlur={commitArgs}
          />
        </div>
        <div className="rounded-md border border-border bg-surface px-2.5 py-1">
          <Textarea
            className="min-h-[52px] font-mono text-xs"
            aria-label={`MCP environment for ${server.id}`}
            placeholder="Environment (KEY=value, one per line)"
            disabled={disabled}
            rows={2}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            onBlur={commitEnv}
          />
        </div>
      </div>

      <p className={`m-0 mt-2 ${mcpStatusClass(status)}`}>{mcpStatusLabel(status)}</p>
      {status?.error ? (
        <p className="m-0 mt-1 text-danger [overflow-wrap:anywhere]">{status.error}</p>
      ) : null}

      <Button variant="subtle" className="mt-2" disabled={disabled} onClick={onRemove}>
        Remove
      </Button>
    </div>
  )
}

function WorkspaceOverrideCard({
  path,
  isActive,
  globalSettings,
  override,
  disabled,
  onSetOverride,
  onOverrideError
}: {
  path: string
  isActive: boolean
  globalSettings: Settings
  override: WorkspaceSettingsOverride | undefined
  disabled?: boolean
  onSetOverride: (
    path: string,
    override: WorkspaceSettingsOverride | null
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  onOverrideError?: (message: string) => void
}) {
  const useOverride = Boolean(override?.useOverride)
  const [provider, setProvider] = useState(override?.provider ?? globalSettings.provider)
  const [model, setModel] = useState(override?.model ?? globalSettings.model)
  const providerOptions = PROVIDER_DEFAULTS.map((p) => ({ value: p.id, label: p.label }))

  useEffect(() => {
    setProvider(override?.provider ?? globalSettings.provider)
    setModel(override?.model ?? globalSettings.model)
  }, [
    override?.provider,
    override?.model,
    globalSettings.provider,
    globalSettings.model
  ])

  const persist = async (patch: Partial<WorkspaceSettingsOverride>): Promise<void> => {
    const res = await onSetOverride(path, {
      ...override,
      useOverride: true,
      provider: patch.provider ?? provider,
      model: patch.model ?? model,
      ...patch
    })
    if (!res.ok) onOverrideError?.(res.error)
  }

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-sm tracking-[var(--vy-tracking)] text-fg-strong">
            {workspaceShort(path)}
            {isActive ? <span className="ml-1.5 text-xs text-muted">· active</span> : null}
          </p>
          <p className="m-0 mt-0.5 truncate text-xs text-secondary" title={path}>
            {path}
          </p>
        </div>
        <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-secondary">
          <input
            type="checkbox"
            className="size-3.5 accent-fg"
            aria-label={`Use custom settings for ${workspaceShort(path)}`}
            disabled={disabled}
            checked={useOverride}
            onChange={(e) => {
              if (e.target.checked) {
                void onSetOverride(path, {
                  useOverride: true,
                  provider: globalSettings.provider,
                  model: globalSettings.model,
                  maxSteps: globalSettings.maxSteps,
                  thinkingEnabled: globalSettings.thinkingEnabled,
                  thinkingEffort: globalSettings.thinkingEffort,
                  showThinking: globalSettings.showThinking,
                  compactionTriggerRatio: globalSettings.compactionTriggerRatio,
                  keepRecentTurns: globalSettings.keepRecentTurns,
                  memoryAutoPromote: globalSettings.memoryAutoPromote
                }).then((res) => {
                  if (!res.ok) onOverrideError?.(res.error)
                })
              } else {
                void onSetOverride(path, {
                  ...override,
                  useOverride: false
                }).then((res) => {
                  if (!res.ok) onOverrideError?.(res.error)
                })
              }
            }}
          />
          Override
        </label>
      </div>
      {useOverride ? (
        <div className="mt-2.5 flex flex-col gap-2 border-t border-border pt-2.5">
          <Menu
            aria-label={`Provider for ${workspaceShort(path)}`}
            value={provider}
            options={providerOptions}
            searchable={false}
            placement="down"
            disabled={disabled}
            onChange={(value) => {
              const nextProvider = value as ProviderId
              const nextModel = defaultModelFor(nextProvider)
              setProvider(nextProvider)
              setModel(nextModel)
              void persist({ provider: nextProvider, model: nextModel })
            }}
          />
          <Input
            className="w-full"
            aria-label={`Model for ${workspaceShort(path)}`}
            disabled={disabled}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => {
              const trimmed = model.trim()
              if (!trimmed) {
                setModel(override?.model ?? globalSettings.model)
                return
              }
              if (trimmed !== (override?.model ?? globalSettings.model)) {
                void persist({ model: trimmed })
              }
            }}
          />
          <p className="m-0 text-[10px] leading-snug text-muted">
            Reasoning and thinking effort are in the composer. Agent limits are in Settings → Agent.
          </p>
        </div>
      ) : (
        <p className="m-0 mt-2 text-xs text-muted">
          Uses global defaults ({providerLabel(globalSettings.provider)} · {globalSettings.model})
        </p>
      )}
    </div>
  )
}

export function SettingsView({
  settings,
  secrets,
  encryptionAvailable = true,
  appError = null,
  onDismissAppError,
  backRef,
  onClose,
  onUpdate,
  onSaveSecret,
  onClearSecret,
  onSetTheme,
  onPickWorkspace,
  onModelsRefreshed,
  activeWorkspacePath = null,
  openWorkspaces = [],
  settingsOverridesByPath = {},
  effectiveChatSettings,
  onSetSettingsOverride,
  section: sectionProp,
  onSectionChange: onSectionChangeProp
}: {
  settings: Settings
  secrets: Record<SecretProvider, boolean>
  encryptionAvailable?: boolean
  /** Errors from App (pick workspace, harness, theme persist, etc.). */
  appError?: string | null
  onDismissAppError?: () => void
  backRef?: Ref<HTMLButtonElement>
  onClose: () => void
  onUpdate: (partial: Partial<Settings>) => Promise<{ ok: true } | { ok: false; error: string }>
  onSaveSecret: (
    provider: SecretProvider,
    key: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  onClearSecret: (
    provider: SecretProvider
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  onSetTheme?: (theme: ThemeId) => void
  onPickWorkspace?: () => Promise<unknown>
  onModelsRefreshed?: () => void
  activeWorkspacePath?: string | null
  openWorkspaces?: string[]
  settingsOverridesByPath?: Record<string, WorkspaceSettingsOverride>
  /** Composer-effective model for the active workspace (when open). */
  effectiveChatSettings?: EffectiveChatSettings
  onSetSettingsOverride?: (
    path: string,
    override: WorkspaceSettingsOverride | null
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  section?: SettingsSection
  onSectionChange?: (section: SettingsSection) => void
}) {
  const [internalSection, setInternalSection] = useState<SettingsSection>('general')
  const section = sectionProp ?? internalSection
  const onSectionChange = onSectionChangeProp ?? setInternalSection
  const [keyProvider, setKeyProvider] = useState<SecretProvider>(() =>
    defaultKeyProvider(settings.provider, secrets)
  )
  const [keyDraft, setKeyDraft] = useState('')
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaBaseUrl)
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<SettingsErrorField>(null)
  const [modelsInfo, setModelsInfo] = useState<string | null>(null)
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [clearingKey, setClearingKey] = useState(false)
  const [savingField, setSavingField] = useState(false)
  const [pickingWorkspace, setPickingWorkspace] = useState(false)
  const [openingLogs, setOpeningLogs] = useState(false)
  const [dsnConfigured, setDsnConfigured] = useState(false)
  const [logsPath, setLogsPath] = useState<string | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus[]>([])
  const [mcpStatusLoading, setMcpStatusLoading] = useState(false)

  const mcpStatusById = useMemo(() => {
    const map = new Map<string, McpServerStatus>()
    for (const row of mcpStatus) map.set(row.id, row)
    return map
  }, [mcpStatus])

  const loadMcpStatus = async (refresh = false): Promise<void> => {
    if (!window.vyotiq.mcpStatus) return
    setMcpStatusLoading(true)
    try {
      const res =
        refresh && window.vyotiq.mcpRefresh
          ? await window.vyotiq.mcpRefresh()
          : await window.vyotiq.mcpStatus()
      if (res.ok) setMcpStatus(res.data.servers)
    } finally {
      setMcpStatusLoading(false)
    }
  }

  useEffect(() => {
    if (section !== 'advanced') return
    void loadMcpStatus()
  }, [section, settings.mcpServers])

  const clearErrors = (): void => {
    setError(null)
    setErrorField(null)
    onDismissAppError?.()
  }

  const setFieldError = (field: SettingsErrorField, message: string): void => {
    setErrorField(field)
    setError(message)
  }

  const displayError = error ?? appError

  const fieldError = (field: SettingsErrorField, id: string): ReactNode =>
    errorField === field && displayError ? (
      <p id={id} className="m-0 w-full text-xs text-danger" role="alert">
        {displayError}
      </p>
    ) : null

  /** Commit a bounded numeric setting, reverting and explaining when the value is out of range. */
  const commitNumberField = (
    field: SettingsErrorField,
    input: HTMLInputElement,
    opts: {
      label: string
      min: number
      max: number
      integer?: boolean
      current: number
      apply: (value: number) => Parameters<typeof runUpdate>[0]
    }
  ): void => {
    const raw = input.value.trim()
    const parsed = Number(raw)
    if (!raw || !Number.isFinite(parsed) || parsed < opts.min || parsed > opts.max) {
      input.value = String(opts.current)
      setFieldError(field, `${opts.label} must be from ${opts.min} to ${opts.max}.`)
      return
    }
    clearErrors()
    const value = opts.integer ? Math.round(parsed) : parsed
    if (value === opts.current) return
    void runUpdate(opts.apply(value))
  }

  const providerMeta = PROVIDER_DEFAULTS.find((p) => p.id === settings.provider)
  const displayProvider = effectiveChatSettings?.provider ?? settings.provider
  const displayModel = effectiveChatSettings?.model ?? settings.model
  const displayProviderMeta = PROVIDER_DEFAULTS.find((p) => p.id === displayProvider)
  const workspaceOverrideActive = Boolean(
    activeWorkspacePath && settingsOverridesByPath[activeWorkspacePath]?.useOverride
  )
  const keyHasSaved = Boolean(secrets[keyProvider])
  const keyProviderLabel = providerLabel(keyProvider)
  const busy = savingKey || clearingKey || savingField || refreshingModels
  const formLocked = savingKey || clearingKey || savingField
  const activeNeedsKey =
    settings.provider !== 'ollama' && !secrets[settings.provider as SecretProvider]
  const savedKeyProviders = useMemo(
    () => SECRET_PROVIDERS.filter((p) => secrets[p]),
    [secrets]
  )
  const { refresh: refreshCatalog } = useModelCatalog(
    settings.provider,
    settings.ollamaBaseUrl,
    undefined,
    false
  )

  useEffect(() => {
    setOllamaUrl(settings.ollamaBaseUrl)
  }, [settings.ollamaBaseUrl])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!window.vyotiq?.telemetryStatus) {
        // Fall back to build-time DSN presence for UI helper text.
        if (!cancelled) {
          setDsnConfigured(Boolean(import.meta.env.VITE_SENTRY_DSN?.trim()))
        }
      } else {
        const res = await window.vyotiq.telemetryStatus()
        if (!cancelled) {
          if (res.ok) setDsnConfigured(res.data.dsnConfigured)
          else setDsnConfigured(Boolean(import.meta.env.VITE_SENTRY_DSN?.trim()))
        }
      }

      if (!window.vyotiq?.getLogsPath) return
      const pathRes = await window.vyotiq.getLogsPath()
      if (!cancelled && pathRes.ok) setLogsPath(pathRes.data)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the credential editor aligned with the active provider.
  useEffect(() => {
    if (settings.provider !== 'ollama') {
      setKeyProvider(settings.provider)
      return
    }
    setKeyProvider(defaultKeyProvider('ollama', secrets))
  }, [settings.provider, secrets])

  useEscapeToClose(onClose, true, { deferToMenus: true })

  const savedKeyCount = useMemo(
    () => SECRET_PROVIDERS.filter((p) => secrets[p]).length,
    [secrets]
  )

  const runUpdate = async (partial: Partial<Settings>): Promise<boolean> => {
    clearErrors()
    setModelsInfo(null)
    setSavingField(true)
    try {
      const res = await onUpdate(partial)
      if (!res.ok) {
        setError(res.error)
        return false
      }
      return true
    } finally {
      setSavingField(false)
    }
  }

  /** Persist active chat provider and keep the credential editor in sync for cloud ids. */
  const setActiveProvider = async (provider: ProviderId): Promise<boolean> => {
    setKeyProvider(
      provider !== 'ollama' ? provider : defaultKeyProvider('ollama', secrets)
    )
    setKeyDraft('')
    if (provider === settings.provider) return true
    const ok = await runUpdate({
      provider,
      model: defaultModelFor(provider)
    })
    if (!ok) return false
    setModelsInfo(`Active provider set to ${providerLabel(provider)}.`)
    return true
  }

  const commitOllamaUrl = async (): Promise<string | null> => {
    const trimmed = ollamaUrl.trim()
    if (!trimmed) {
      setOllamaUrl(settings.ollamaBaseUrl)
      setFieldError('ollama', 'Ollama base URL cannot be empty.')
      return null
    }
    if (!isValidHttpUrl(trimmed)) {
      setOllamaUrl(settings.ollamaBaseUrl)
      setFieldError('ollama', 'Ollama base URL must be a valid http(s) URL.')
      return null
    }
    const normalized = normalizeOllamaHost(trimmed)
    if (normalized !== ollamaUrl) setOllamaUrl(normalized)
    if (normalized === settings.ollamaBaseUrl) return normalized
    const ok = await runUpdate({ ollamaBaseUrl: normalized })
    if (!ok) {
      setOllamaUrl(settings.ollamaBaseUrl)
      return null
    }
    return normalized
  }

  const refreshModels = async (
    provider = settings.provider,
    opts?: { skipKeyCheck?: boolean }
  ): Promise<void> => {
    clearErrors()
    setModelsInfo(null)
    setRefreshingModels(true)
    try {
      // Cloud providers need a saved key; calling without one hits opaque upstream 401s
      // (DeepSeek: "Authentication Fails (governor)"). Skip when we just saved the key —
      // parent secrets props may not have re-rendered yet.
      if (provider !== 'ollama' && !opts?.skipKeyCheck) {
        const hasKey = Boolean(secrets[provider as SecretProvider])
        if (!hasKey) {
          const label = providerLabel(provider)
          setModelsInfo(`Seed catalog for ${label} (API key missing)`)
          setError(
            `${label} API key not set. Save a ${label} key below, then refresh.`
          )
          return
        }
      }

      let ollamaHost: string | undefined
      if (provider === 'ollama') {
        const host = await commitOllamaUrl()
        if (!host) return
        ollamaHost = host
      }
      const res = await refreshCatalog({
        forceRefresh: true,
        provider,
        ollamaBaseUrl: ollamaHost
      })
      if (res.ok) {
        onModelsRefreshed?.()
        const label = providerLabel(provider)
        if (res.warning) {
          setModelsInfo(
            `${res.models.length} seed models for ${label} (live catalog unavailable)`
          )
          setError(res.warning)
        } else {
          setModelsInfo(`${res.models.length} models for ${label}`)
        }
      } else {
        setError(res.error)
      }
    } finally {
      setRefreshingModels(false)
    }
  }

  const saveKey = async (): Promise<void> => {
    const value = keyDraft.trim()
    if (!value) {
      setFieldError('apikey', 'API key cannot be empty.')
      return
    }
    clearErrors()
    setModelsInfo(null)
    setSavingKey(true)
    try {
      const res = await onSaveSecret(keyProvider, value)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setKeyDraft('')
      // Saving a cloud key activates that provider so Refresh/chat use it immediately.
      const activated =
        keyProvider === settings.provider || (await setActiveProvider(keyProvider))
      if (!activated) return
      await refreshModels(keyProvider, { skipKeyCheck: true })
    } finally {
      setSavingKey(false)
    }
  }

  const sectionNav = (id: SettingsSection, label: string): ReactNode => (
    <NavItem
      variant="settings"
      label={label}
      active={section === id}
      current={section === id}
      onClick={() => {
        onSectionChange(id)
        clearErrors()
        setModelsInfo(null)
      }}
    />
  )


  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg animate-fade-in">
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav
          className="flex shrink-0 flex-row items-center gap-1 overflow-x-auto bg-bg px-2 py-2 sm:w-[160px] sm:flex-col sm:items-stretch sm:gap-px sm:overflow-visible sm:py-2.5"
          aria-label="Settings sections"
        >
          <button
            ref={backRef}
            type="button"
            className="mr-1 inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted vy-transition hover:bg-surface hover:text-fg sm:mb-1.5 sm:mr-0 sm:w-full"
            onClick={onClose}
          >
            <Icon name="chevron" size={12} className="rotate-90" />
            Back
          </button>
          <div className="flex min-w-0 flex-1 gap-1 sm:flex-col sm:gap-px">
            {sectionNav('general', 'General')}
            {sectionNav('providers', 'Providers')}
            {sectionNav('agent', 'Agent')}
            {sectionNav('advanced', 'Advanced')}
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col overflow-auto bg-bg">
          <div className="mx-auto flex w-full max-w-[520px] flex-col px-4 sm:px-0">
            <div className="flex flex-col px-1 pb-7 sm:px-5">
            {section === 'general' ? (
              <>
                <SettingsRow
                  title="Active model"
                  description={
                    workspaceOverrideActive
                      ? `${displayProviderMeta?.label ?? displayProvider} · ${displayModel} for the active workspace (override). Global default: ${providerMeta?.label ?? settings.provider} · ${settings.model}.`
                      : `${displayProviderMeta?.label ?? displayProvider} · ${displayModel}. Change provider in Providers; pick the model in the composer.`
                  }
                >
                  <span className="max-w-[200px] truncate rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-secondary">
                    {displayModel}
                  </span>
                </SettingsRow>

                <SettingsRow
                  stacked
                  title="Workspaces"
                  description="Open workspace tabs. Enable Override for per-workspace provider and model only."
                >
                  {openWorkspaces.length === 0 ? (
                    <p className="m-0 text-xs text-secondary">No workspaces open.</p>
                  ) : (
                    <div className="flex w-full flex-col gap-2">
                      {openWorkspaces.map((path) => (
                        <WorkspaceOverrideCard
                          key={path}
                          path={path}
                          isActive={path === activeWorkspacePath}
                          globalSettings={settings}
                          override={settingsOverridesByPath[path]}
                          disabled={formLocked || !onSetSettingsOverride}
                          onSetOverride={onSetSettingsOverride ?? (async () => ({ ok: true as const }))}
                          onOverrideError={(message) => setError(message)}
                        />
                      ))}
                    </div>
                  )}
                  {onPickWorkspace ? (
                    <Button
                      variant="subtle"
                      pending={pickingWorkspace}
                      disabled={formLocked}
                      onClick={() => {
                        clearErrors()
                        setModelsInfo(null)
                        setPickingWorkspace(true)
                        void Promise.resolve(onPickWorkspace())
                          .catch((err: unknown) => {
                            setError(err instanceof Error ? err.message : String(err))
                          })
                          .finally(() => setPickingWorkspace(false))
                      }}
                    >
                      {pickingWorkspace ? 'Opening…' : 'Add workspace'}
                    </Button>
                  ) : null}
                </SettingsRow>

                {onSetTheme ? (
                  <SettingsRow title="Appearance" description="Window chrome theme.">
                    <Menu
                      aria-label="Theme"
                      value={settings.theme}
                      options={THEME_OPTIONS}
                      searchable={false}
                      placement="down"
                      disabled={formLocked}
                      onChange={(v) => {
                        clearErrors()
                        onSetTheme(v as ThemeId)
                      }}
                    />
                  </SettingsRow>
                ) : null}

                <SettingsRow
                  title="Show thinking in chat"
                  description="Collapsed thinking blocks above assistant replies when the model returns reasoning."
                >
                  <label className="inline-flex items-center gap-2 text-xs text-secondary">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-fg"
                      aria-label="Show thinking in chat"
                      disabled={formLocked}
                      checked={settings.showThinking}
                      onChange={(e) => {
                        void runUpdate({ showThinking: e.target.checked })
                      }}
                    />
                    {settings.showThinking ? 'On' : 'Off'}
                  </label>
                </SettingsRow>

                <SettingsRow
                  title="Share crash & error reports"
                  description={
                    dsnConfigured
                      ? 'Optional opt-in. Never includes chat contents, API keys, or file bodies. Local rotating logs are always written.'
                      : 'Reporting unavailable in this build (no Sentry DSN). Local rotating logs are always written.'
                  }
                >
                  <label className="inline-flex items-center gap-2 text-xs text-secondary">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-fg"
                      aria-label="Share crash and error reports"
                      disabled={formLocked || !dsnConfigured}
                      checked={dsnConfigured && settings.telemetryEnabled}
                      onChange={(e) => {
                        void runUpdate({ telemetryEnabled: e.target.checked })
                      }}
                    />
                    {settings.telemetryEnabled && dsnConfigured ? 'On' : 'Off'}
                  </label>
                </SettingsRow>

                <SettingsRow
                  title="Logs"
                  description={
                    logsPath
                      ? `Local rotating logs at ${logsPath}`
                      : 'Open the local logs folder for troubleshooting.'
                  }
                >
                  <Button
                    variant="subtle"
                    pending={openingLogs}
                    disabled={formLocked}
                    onClick={() => {
                      clearErrors()
                      setOpeningLogs(true)
                      void (window.vyotiq?.openLogsDir?.() ?? Promise.reject(new Error('Logs API unavailable')))
                        .then((res) => {
                          if (!res.ok) setError(res.error)
                        })
                        .catch((err: unknown) => {
                          setError(err instanceof Error ? err.message : String(err))
                        })
                        .finally(() => setOpeningLogs(false))
                    }}
                  >
                    {openingLogs ? 'Opening…' : 'Open logs folder'}
                  </Button>
                </SettingsRow>
              </>
            ) : null}

            {section === 'providers' ? (
              <>
                <SettingsRow
                  title="Active provider"
                  description="Used for chat and Refresh models. Selecting a provider here (or an API key chip) makes it active."
                >
                  <Menu
                    aria-label="Active provider"
                    value={settings.provider}
                    options={ACTIVE_PROVIDER_OPTIONS}
                    searchable={false}
                    placement="down"
                    disabled={formLocked}
                    onChange={(v) => {
                      void setActiveProvider(v as ProviderId)
                    }}
                  />
                </SettingsRow>

                {activeNeedsKey && savedKeyProviders.length > 0 ? (
                  <p
                    className="m-0 border-b border-border py-3 text-xs leading-snug text-secondary [overflow-wrap:anywhere]"
                    role="status"
                  >
                    Active provider is {providerLabel(settings.provider)} but its API key is
                    missing. Switch to a provider with a saved key:{' '}
                    {savedKeyProviders.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="mr-1.5 inline-flex rounded-sm border border-border bg-surface px-1.5 py-0.5 text-xs text-fg-strong vy-transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-[var(--vy-disabled-opacity)]"
                        disabled={formLocked}
                        onClick={() => {
                          void setActiveProvider(id)
                        }}
                      >
                        Use {providerLabel(id)}
                      </button>
                    ))}
                  </p>
                ) : null}

                <SettingsRow title="Ollama base URL" description="Local OpenAI-compatible endpoint.">
                  <Input
                    id="ollama"
                    className="w-[240px] max-w-[46vw]"
                    aria-label="Ollama base URL"
                    aria-invalid={errorField === 'ollama' ? true : undefined}
                    aria-describedby={errorField === 'ollama' ? 'ollama-error' : undefined}
                    disabled={formLocked}
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    onBlur={() => {
                      void commitOllamaUrl()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      }
                    }}
                  />
                  {fieldError('ollama', 'ollama-error')}
                </SettingsRow>

                <SettingsRow
                  stacked
                  title="API keys"
                  description={
                    encryptionAvailable
                      ? `OS secure storage · ${savedKeyCount}/${SECRET_PROVIDERS.length} saved. Selecting a provider sets it active and opens its key editor.`
                      : 'OS secure storage is unavailable on this system. API keys cannot be saved or decrypted until it is enabled.'
                  }
                >
                  {!encryptionAvailable ? (
                    <p className="m-0 mb-2 w-full text-xs leading-snug text-secondary" role="status">
                      Secure storage unavailable — provider keys will show as missing until the OS
                      keychain/credential store is available.
                    </p>
                  ) : null}
                  <div className="flex w-full flex-col gap-2">
                    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="API key status">
                      {SECRET_PROVIDERS.map((id) => {
                        const saved = secrets[id]
                        const editing = id === keyProvider
                        const isActive = id === settings.provider
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              className={cn(
                                'rounded-md border px-2 py-1 text-xs tracking-[var(--vy-tracking)] vy-transition',
                                editing || isActive
                                  ? 'border-fg/30 bg-surface-2 text-fg-strong'
                                  : 'border-border bg-surface text-secondary hover:text-fg',
                                saved ? '' : 'opacity-80'
                              )}
                              aria-pressed={editing}
                              disabled={(!encryptionAvailable && !saved) || formLocked}
                              onClick={() => {
                                void setActiveProvider(id)
                              }}
                            >
                              {providerLabel(id)}
                              <span className="ml-1 text-muted">
                                {isActive
                                  ? '· active'
                                  : saved
                                    ? '· saved'
                                    : encryptionAvailable
                                      ? '· missing'
                                      : '· unavailable'}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>

                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id="apikey"
                        className="min-w-[200px] flex-1"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`API key (${keyProviderLabel})`}
                        aria-invalid={errorField === 'apikey' ? true : undefined}
                        aria-describedby={errorField === 'apikey' ? 'apikey-error' : undefined}
                        value={keyDraft}
                        placeholder={
                          !encryptionAvailable
                            ? 'Secure storage unavailable'
                            : keyHasSaved
                              ? '•••••••• (saved)'
                              : 'Paste API key'
                        }
                        disabled={!encryptionAvailable || savingKey || clearingKey}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && keyDraft.trim() && !savingKey) {
                            e.preventDefault()
                            void saveKey()
                          }
                        }}
                      />
                      {errorField === 'apikey' && displayError ? (
                        <p id="apikey-error" className="m-0 w-full text-xs text-danger" role="alert">
                          {displayError}
                        </p>
                      ) : null}
                      <Button
                        variant="primary"
                        pending={savingKey}
                        disabled={
                          !encryptionAvailable || !keyDraft.trim() || clearingKey
                        }
                        onClick={() => {
                          void saveKey()
                        }}
                      >
                        {savingKey ? 'Saving…' : 'Save key'}
                      </Button>
                      {keyHasSaved ? (
                        <Button
                          variant="subtle"
                          pending={clearingKey}
                          disabled={savingKey}
                          onClick={() => {
                            clearErrors()
                            setModelsInfo(null)
                            setClearingKey(true)
                            void onClearSecret(keyProvider)
                              .then((res) => {
                                if (!res.ok) setError(res.error)
                                else {
                                  setKeyDraft('')
                                  setModelsInfo(`Cleared ${keyProviderLabel} key.`)
                                }
                              })
                              .finally(() => setClearingKey(false))
                          }}
                        >
                          {clearingKey ? 'Clearing…' : 'Clear'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </SettingsRow>

                <SettingsRow
                  title="Refresh models"
                  description={`Reload the live catalog for ${providerMeta?.label ?? settings.provider}.`}
                >
                  <Button
                    variant="subtle"
                    pending={refreshingModels}
                    disabled={busy && !refreshingModels}
                    onClick={() => {
                      void refreshModels()
                    }}
                  >
                    {refreshingModels ? 'Refreshing…' : 'Refresh models'}
                  </Button>
                </SettingsRow>
                {modelsInfo ? (
                  <p
                    className="m-0 border-b border-border py-3 text-xs text-secondary [overflow-wrap:anywhere]"
                    role="status"
                  >
                    {modelsInfo}
                  </p>
                ) : null}
              </>
            ) : null}

            {section === 'agent' ? (
              <>
                <SettingsRow
                  title="Max steps"
                  description="Maximum agent tool loop iterations per run (1–100)."
                >
                  <Input
                    type="number"
                    className="w-24"
                    aria-label="Max steps"
                    min={1}
                    max={100}
                    disabled={formLocked}
                    defaultValue={settings.maxSteps}
                    key={`max-steps-${settings.maxSteps}`}
                    aria-invalid={errorField === 'maxSteps' ? true : undefined}
                    aria-describedby={errorField === 'maxSteps' ? 'max-steps-error' : undefined}
                    onBlur={(e) => {
                      commitNumberField('maxSteps', e.target, {
                        label: 'Max steps',
                        min: 1,
                        max: 100,
                        integer: true,
                        current: settings.maxSteps,
                        apply: (maxSteps) => ({ maxSteps })
                      })
                    }}
                  />
                  {fieldError('maxSteps', 'max-steps-error')}
                </SettingsRow>

                <SettingsRow
                  title="Compaction trigger"
                  description="Context usage ratio that triggers compaction (0.5–0.95)."
                >
                  <Input
                    type="number"
                    className="w-24"
                    aria-label="Compaction trigger ratio"
                    min={0.5}
                    max={0.95}
                    step={0.05}
                    disabled={formLocked}
                    defaultValue={settings.compactionTriggerRatio}
                    key={`compaction-${settings.compactionTriggerRatio}`}
                    aria-invalid={errorField === 'compaction' ? true : undefined}
                    aria-describedby={errorField === 'compaction' ? 'compaction-error' : undefined}
                    onBlur={(e) => {
                      commitNumberField('compaction', e.target, {
                        label: 'Compaction trigger ratio',
                        min: 0.5,
                        max: 0.95,
                        current: settings.compactionTriggerRatio,
                        apply: (compactionTriggerRatio) => ({ compactionTriggerRatio })
                      })
                    }}
                  />
                  {fieldError('compaction', 'compaction-error')}
                </SettingsRow>

                <SettingsRow
                  title="Keep recent turns"
                  description="Recent conversation turns preserved during compaction (4–50)."
                >
                  <Input
                    type="number"
                    className="w-24"
                    aria-label="Keep recent turns"
                    min={4}
                    max={50}
                    disabled={formLocked}
                    defaultValue={settings.keepRecentTurns}
                    key={`keep-turns-${settings.keepRecentTurns}`}
                    aria-invalid={errorField === 'keepTurns' ? true : undefined}
                    aria-describedby={errorField === 'keepTurns' ? 'keep-turns-error' : undefined}
                    onBlur={(e) => {
                      commitNumberField('keepTurns', e.target, {
                        label: 'Keep recent turns',
                        min: 4,
                        max: 50,
                        integer: true,
                        current: settings.keepRecentTurns,
                        apply: (keepRecentTurns) => ({ keepRecentTurns })
                      })
                    }}
                  />
                  {fieldError('keepTurns', 'keep-turns-error')}
                </SettingsRow>

                <SettingsRow
                  title="Auto-promote memory"
                  description="Write compaction facts into workspace memory."
                >
                  <label className="inline-flex items-center gap-2 text-xs text-secondary">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-fg"
                      aria-label="Auto-promote memory"
                      disabled={formLocked}
                      checked={settings.memoryAutoPromote}
                      onChange={(e) => {
                        void runUpdate({ memoryAutoPromote: e.target.checked })
                      }}
                    />
                    {settings.memoryAutoPromote ? 'On' : 'Off'}
                  </label>
                </SettingsRow>
              </>
            ) : null}

            {section === 'advanced' ? (
              <>
                <SettingsRow
                  stacked
                  title="MCP servers"
                  description="External tool servers (stdio). Tools are namespaced as mcp__serverId__toolName. Agent limits are in Settings → Agent."
                >
                  <div className="flex w-full flex-col gap-2">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="subtle"
                        disabled={formLocked || mcpStatusLoading}
                        onClick={() => {
                          void loadMcpStatus(true)
                        }}
                      >
                        {mcpStatusLoading ? 'Refreshing…' : 'Refresh connections'}
                      </Button>
                    </div>
                    {settings.mcpServers.map((server) => (
                      <McpServerCard
                        key={server.id}
                        server={server}
                        status={mcpStatusById.get(server.id)}
                        disabled={formLocked}
                        onUpdate={async (next) => {
                          const updated = settings.mcpServers.map((s) =>
                            s.id === server.id ? next : s
                          )
                          return runUpdate({ mcpServers: updated })
                        }}
                        onRemove={() => {
                          void runUpdate({
                            mcpServers: settings.mcpServers.filter((s) => s.id !== server.id)
                          })
                        }}
                      />
                    ))}
                    <Button
                      variant="subtle"
                      disabled={formLocked}
                      onClick={() => {
                        const id = crypto.randomUUID()
                        const next: McpServer = {
                          id,
                          name: 'New MCP server',
                          command: 'npx',
                          args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
                          enabled: false
                        }
                        void runUpdate({ mcpServers: [...settings.mcpServers, next] })
                      }}
                    >
                      Add MCP server
                    </Button>
                  </div>
                </SettingsRow>
              </>
            ) : null}

            {displayError && !errorField ? (
              <AlertBlock className="mt-3">
                {displayError}
              </AlertBlock>
            ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
