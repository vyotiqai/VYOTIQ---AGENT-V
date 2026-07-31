import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  SECRET_PROVIDERS,
  type ProviderId,
  type SecretProvider,
  type Settings,
  type ToolApprovalSettings,
  type WorkspaceSettingsOverride,
  DEFAULT_TOOL_APPROVAL
} from '@shared/ipc'
import { PROVIDER_DEFAULTS, defaultModelFor, providerLabel, normalizeOllamaHost } from '@shared/providers'
import { findByWorkspacePath } from '@shared/workspacePathMatch'
import { useEscapeToClose } from '@renderer/lib/hooks/useEscapeToClose'
import { useModelCatalog } from '@renderer/lib/hooks/useModelCatalog'
import type { SettingsErrorField, SettingsSection, SettingsViewProps } from '../types'
import { defaultKeyProvider, isValidHttpUrl } from '../utils/settingsHelpers'

export type AgentSettingsPatch = Partial<
  Pick<
    WorkspaceSettingsOverride,
    | 'compactionTriggerRatio'
    | 'keepRecentTurns'
    | 'toolApproval'
    | 'subagentProvider'
    | 'subagentModel'
    | 'showThinking'
    | 'thinkingEnabled'
    | 'thinkingEffort'
  >
>

export type SettingsFormState = ReturnType<typeof useSettingsForm>

export function useSettingsForm({
  settings,
  secrets,
  encryptionAvailable = true,
  appError = null,
  onDismissAppError,
  onClose,
  onUpdate,
  onSaveSecret,
  onClearSecret,
  onModelsRefreshed,
  activeWorkspacePath = null,
  settingsOverridesByPath = {},
  effectiveChatSettings,
  onSetSettingsOverride,
  section: sectionProp,
  onSectionChange: onSectionChangeProp
}: SettingsViewProps) {
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

  /**
   * Agent-section fields write to the active workspace override when override is on;
   * otherwise they update global settings.
   */
  const runAgentUpdate = async (patch: AgentSettingsPatch): Promise<boolean> => {
    if (workspaceOverrideActive && activeWorkspacePath && onSetSettingsOverride) {
      clearErrors()
      setModelsInfo(null)
      setSavingField(true)
      try {
        const current =
          findByWorkspacePath(settingsOverridesByPath, activeWorkspacePath) ?? undefined
        const res = await onSetSettingsOverride(activeWorkspacePath, {
          ...current,
          useOverride: true,
          ...patch
        })
        if (!res.ok) {
          setError(res.error)
          return false
        }
        return true
      } finally {
        setSavingField(false)
      }
    }
    return runUpdate(patch)
  }

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
      apply: (value: number) => Partial<Settings>
      /** Defaults to global `runUpdate`; Agent section passes `runAgentUpdate`. */
      persist?: (partial: Partial<Settings>) => void
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
    const partial = opts.apply(value)
    if (opts.persist) opts.persist(partial)
    else void runUpdate(partial)
  }

  const providerMeta = PROVIDER_DEFAULTS.find((p) => p.id === settings.provider)
  const displayProvider = effectiveChatSettings?.provider ?? settings.provider
  const displayModel = effectiveChatSettings?.model ?? settings.model
  const displayProviderMeta = PROVIDER_DEFAULTS.find((p) => p.id === displayProvider)
  const workspaceOverrideActive = Boolean(
    activeWorkspacePath &&
      findByWorkspacePath(settingsOverridesByPath, activeWorkspacePath)?.useOverride
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

  const toolApproval: ToolApprovalSettings =
    (workspaceOverrideActive ? effectiveChatSettings?.toolApproval : undefined) ??
    settings.toolApproval ??
    DEFAULT_TOOL_APPROVAL

  const agentCompactionTriggerRatio =
    (workspaceOverrideActive ? effectiveChatSettings?.compactionTriggerRatio : undefined) ??
    settings.compactionTriggerRatio
  const agentKeepRecentTurns =
    (workspaceOverrideActive ? effectiveChatSettings?.keepRecentTurns : undefined) ??
    settings.keepRecentTurns

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
            `${res.models.length} seed models for ${label} (live catalog unavailable): ${res.warning}`
          )
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
      const activated =
        keyProvider === settings.provider || (await setActiveProvider(keyProvider))
      if (!activated) return
      await refreshModels(keyProvider, { skipKeyCheck: true })
    } finally {
      setSavingKey(false)
    }
  }

  const clearKey = async (onClearSecret: SettingsViewProps['onClearSecret']): Promise<void> => {
    clearErrors()
    setModelsInfo(null)
    setClearingKey(true)
    try {
      const res = await onClearSecret(keyProvider)
      if (!res.ok) setError(res.error)
      else {
        setKeyDraft('')
        setModelsInfo(`Cleared ${keyProviderLabel} key.`)
      }
    } finally {
      setClearingKey(false)
    }
  }

  const navigateSection = (id: SettingsSection): void => {
    onSectionChange(id)
    clearErrors()
    setModelsInfo(null)
  }

  const setErrorMessage = (message: string): void => {
    setError(message)
  }

  return {
    section,
    navigateSection,
    settings,
    keyProvider,
    keyDraft,
    setKeyDraft,
    ollamaUrl,
    setOllamaUrl,
    error,
    errorField,
    modelsInfo,
    setModelsInfo,
    refreshingModels,
    savingKey,
    clearingKey,
    savingField,
    pickingWorkspace,
    setPickingWorkspace,
    openingLogs,
    setOpeningLogs,
    dsnConfigured,
    logsPath,
    clearErrors,
    displayError,
    fieldError,
    commitNumberField,
    providerMeta,
    displayProvider,
    displayModel,
    displayProviderMeta,
    workspaceOverrideActive,
    effectiveChatSettings,
    keyHasSaved,
    keyProviderLabel,
    busy,
    formLocked,
    activeNeedsKey,
    savedKeyProviders,
    savedKeyCount,
    toolApproval,
    agentCompactionTriggerRatio,
    agentKeepRecentTurns,
    agentSubagentProvider: effectiveChatSettings?.subagentProvider,
    agentSubagentModel: effectiveChatSettings?.subagentModel,
    displaySubagentProvider: effectiveChatSettings?.subagentProvider ?? settings.subagentProvider,
    displaySubagentModel: effectiveChatSettings?.subagentModel ?? settings.subagentModel,
    encryptionAvailable,
    runUpdate,
    runAgentUpdate,
    setActiveProvider,
    commitOllamaUrl,
    refreshModels,
    saveKey,
    clearKey,
    setErrorMessage
  }
}
