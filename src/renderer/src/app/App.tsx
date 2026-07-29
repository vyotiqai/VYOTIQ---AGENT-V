import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from './AppShell'
import { ChatView } from '../features/chat/ChatView'
import { SettingsView, type SettingsSection } from '../features/settings'
import { MarketplaceView } from '../features/marketplace'
import { useTheme } from '@renderer/lib/hooks/useTheme'
import { useSettings } from '@renderer/lib/hooks/useSettings'
import { useWorkspaceManager } from '@renderer/lib/hooks/useWorkspaceManager'
import { ErrorBoundary } from '@renderer/lib/ErrorBoundary'
import type { ProviderId, SecretProvider, ServiceTier, AttachedFile } from '@shared/ipc'
import { defaultModelFor } from '@shared/providers'
import {
  resolveEffectiveSettings,
  type ChatSettingsPatch
} from '@shared/effectiveSettings'
import {
  DEFAULT_THINKING_PREFS,
  modelSelectionKey,
  pushRecentModel,
  resolveServiceTier
} from '@shared/domain/modelSelection'
import { logger } from '@shared/logger'
import { workspacePathsEqual } from '@shared/workspacePathMatch'

/** Sent as a visible user turn when resuming a run that was cut short. */
const CONTINUE_PROMPT = 'Continue from where you stopped.'

export function App() {
  const {
    settings,
    secrets,
    encryptionAvailable,
    loading,
    refresh,
    update,
    saveSecret,
    removeSecret,
    pickWorkspace,
    error: settingsError,
    setError: setSettingsError
  } = useSettings()
  const { setTheme, hydrate } = useTheme(settings.theme)
  const workspace = useWorkspaceManager()
  const {
    registry,
    activeWorkspace,
    openWorkspaces,
    activeContext,
    contexts,
    activeRuns,
    chat,
    chatActions,
    onLoadToolContent,
    onThinkingToggle,
    onToolToggle,
    onGroupToggle,
    onTurnToggle,
    onApprovalDecision,
    collapsedTurns,
    openRunTab,
    openRunInWorkspace,
    closeRunTab,
    setSessionQuery,
    addWorkspace,
    switchWorkspace,
    removeWorkspace,
    getRunController,
    loadRunIntoTab: loadRunTranscriptIntoTab,
    refreshActiveRuns,
    refreshWorkspaceRuns,
    workspaceHasBackgroundRun,
    scrollRestoreToken,
    setComposerDraft,
    setAgentMode,
    onMessageListScroll,
    setSettingsOverride,
    workspaceError,
    clearWorkspaceError,
    clearRunsError,
    activeScrollTop,
    chatSurfaceEpoch
  } = workspace

  const [view, setView] = useState<'chat' | 'settings' | 'marketplace'>('chat')
  const [marketplaceFocusServerId, setMarketplaceFocusServerId] = useState<string | null>(null)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [modelsRefreshNonce, setModelsRefreshNonce] = useState(0)
  const chatHeadingRef = useRef<HTMLHeadingElement>(null)
  const settingsBackRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (view === 'settings') {
      window.setTimeout(() => settingsBackRef.current?.focus(), 0)
    } else if (view === 'marketplace') {
      // MarketplaceView focuses its Close control on mount.
    } else if (view === 'chat') {
      window.setTimeout(() => chatHeadingRef.current?.focus(), 0)
    }
  }, [view])

  useLayoutEffect(() => {
    hydrate(settings.theme)
  }, [settings.theme, hydrate])

  const onProviderModel = (provider: ProviderId, model: string): void => {
    const resolvedModel = model || defaultModelFor(provider)
    const key = modelSelectionKey(provider, resolvedModel)
    const recentModels = pushRecentModel(settings.recentModels, key)
    const prefs = settings.thinkingPrefsByProvider[provider] ?? DEFAULT_THINKING_PREFS
    const serviceTier = settings.serviceTierByModel[key] ?? 'default'

    const globalPatch = {
      recentModels,
      thinkingEnabled: prefs.thinkingEnabled,
      thinkingEffort: prefs.thinkingEffort,
      serviceTier
    }

    const override = activeContext?.settingsOverride
    if (override?.useOverride && activeWorkspace) {
      void setSettingsOverride(activeWorkspace, {
        ...override,
        useOverride: true,
        provider,
        model: resolvedModel,
        thinkingEnabled: prefs.thinkingEnabled,
        thinkingEffort: prefs.thinkingEffort
      }).then((res) => {
        if (!res.ok) setSettingsError(res.error)
      })
      void update(globalPatch)
      return
    }
    void update({
      provider,
      model: resolvedModel,
      ...globalPatch
    })
  }

  const onToggleFavorite = (provider: ProviderId, model: string): void => {
    const key = modelSelectionKey(provider, model)
    const set = new Set(settings.favoriteModels)
    if (set.has(key)) set.delete(key)
    else set.add(key)
    void update({ favoriteModels: [...set] })
  }

  const onServiceTierChange = (tier: ServiceTier): void => {
    const key = modelSelectionKey(effectiveChatSettings.provider, effectiveChatSettings.model)
    void update({
      serviceTier: tier,
      serviceTierByModel: { ...settings.serviceTierByModel, [key]: tier }
    })
  }

  const onChatSettingsChange = (patch: ChatSettingsPatch): void => {
    const provider = effectiveChatSettings.provider
    const thinkingPrefsByProvider = { ...settings.thinkingPrefsByProvider }
    if (patch.thinkingEnabled !== undefined || patch.thinkingEffort !== undefined) {
      const current = thinkingPrefsByProvider[provider] ?? DEFAULT_THINKING_PREFS
      thinkingPrefsByProvider[provider] = {
        thinkingEnabled: patch.thinkingEnabled ?? current.thinkingEnabled,
        thinkingEffort: patch.thinkingEffort ?? current.thinkingEffort
      }
    }

    const override = activeContext?.settingsOverride
    if (override?.useOverride && activeWorkspace) {
      void setSettingsOverride(activeWorkspace, {
        ...override,
        useOverride: true,
        ...patch
      }).then((res) => {
        if (!res.ok) setSettingsError(res.error)
      })
      if (Object.keys(thinkingPrefsByProvider).length) {
        void update({ thinkingPrefsByProvider })
      }
      return
    }
    void update({ ...patch, thinkingPrefsByProvider })
  }

  const effectiveChatSettings = resolveEffectiveSettings(
    settings,
    activeContext?.settingsOverride
  )

  const loadRunIntoTab = async (runId: string): Promise<void> => {
    if (!activeWorkspace) return
    await loadRunTranscriptIntoTab(activeWorkspace, runId)
  }

  const onSelectRun = async (runId: string): Promise<void> => {
    if (!activeWorkspace || !chatActions) {
      setSettingsError('Session loading is unavailable.')
      setView('chat')
      return
    }
    openRunTab(runId)
    const ctrl = getRunController(runId)
    if (!ctrl || ctrl.items.length === 0) {
      await loadRunIntoTab(runId)
    }
    setView('chat')
  }

  const onSelectRunInWorkspace = async (path: string, runId: string): Promise<void> => {
    if (!chatActions) {
      setSettingsError('Session loading is unavailable.')
      setView('chat')
      return
    }
    await openRunInWorkspace(path, runId)
    const ctrl = getRunController(runId)
    if (!ctrl || ctrl.items.length === 0) {
      await loadRunTranscriptIntoTab(path, runId)
    }
    setView('chat')
  }

  const onNewChat = (): void => {
    openRunTab(null)
    setView('chat')
  }

  const onPickWorkspace = (): void => {
    void pickWorkspace().then(async (res) => {
      if (res.ok && res.data) {
        await addWorkspace(res.data)
      }
    })
  }

  const chatActionsRef = useRef(chatActions)
  chatActionsRef.current = chatActions

  const onChatSend = useCallback(
    async (text: string, images?: string[], files?: AttachedFile[]) =>
      chatActionsRef.current?.send(text, images, files) ?? false,
    []
  )

  const onChatStop = useCallback(() => {
    void chatActionsRef.current?.stop()
  }, [])

  const onChatContinue = useCallback(() => {
    void chatActionsRef.current?.send(CONTINUE_PROMPT)
  }, [])

  const activeRunId = chat.runId
  const [undoBusy, setUndoBusy] = useState(false)
  const onCompactContext = useCallback(async () => {
    if (!activeWorkspace || !activeRunId) {
      return { ok: false as const, message: 'Compaction is unavailable.' }
    }
    const res = await window.vyotiq.chatCompact(activeWorkspace, activeRunId)
    if (!res.ok) return { ok: false as const, message: res.error }
    chatActionsRef.current?.applyManualCompaction?.(res.data)
    return {
      ok: true as const,
      message: `Summarized ${res.data.messagesBefore - res.data.keptMessages} messages; ${res.data.keptMessages} kept verbatim.`
    }
  }, [activeWorkspace, activeRunId])

  const resolveAgentWrites = useCallback(
    async (action: 'keep' | 'discard', paths?: string[]): Promise<boolean> => {
      if (!activeWorkspace || !activeRunId) {
        setSettingsError('Keep/Discard is unavailable.')
        return false
      }
      if (chat.running) {
        setSettingsError('Stop the run before resolving agent writes.')
        return false
      }
      const checkpointId = chat.writeCheckpoint?.undone
        ? undefined
        : chat.writeCheckpoint?.checkpointId
      setUndoBusy(true)
      try {
        const res = await window.vyotiq.resolveWrites({
          workspacePath: activeWorkspace,
          runId: activeRunId,
          ...(checkpointId ? { checkpointId } : {}),
          action,
          ...(paths?.length ? { paths } : {})
        })
        if (!res.ok) {
          setSettingsError(res.error)
          return false
        }
        chatActionsRef.current?.applyWriteCheckpointResolution?.(res.data)
        setSettingsError(null)
        return true
      } finally {
        setUndoBusy(false)
      }
    },
    [activeWorkspace, activeRunId, chat.running, chat.writeCheckpoint]
  )

  const onUndoWrites = useCallback(async (): Promise<boolean> => {
    return resolveAgentWrites('discard')
  }, [resolveAgentWrites])

  const onKeepWriteFile = useCallback(
    (path: string) => resolveAgentWrites('keep', [path]),
    [resolveAgentWrites]
  )
  const onDiscardWriteFile = useCallback(
    (path: string) => resolveAgentWrites('discard', [path]),
    [resolveAgentWrites]
  )
  const onKeepAllWrites = useCallback(
    () => resolveAgentWrites('keep'),
    [resolveAgentWrites]
  )

  const writeFileResolutions = useMemo(() => {
    const files = chat.writeCheckpoint?.files
    if (!files?.length) return undefined
    const map = new Map<string, 'kept' | 'discarded' | undefined>()
    for (const f of files) {
      map.set(f.path, f.resolved)
    }
    return map
  }, [chat.writeCheckpoint])

  const slashHandlersValue = useMemo(
    () => ({
      onCompact: async () => {
        const result = await onCompactContext()
        if (!result.ok) {
          setSettingsError(result.message)
          return false
        }
        setSettingsError(null)
        return true
      },
      onUndoWrites: () => onUndoWrites(),
      onSetAgentMode: (mode: import('@shared/ipc').AgentInteractionMode) => {
        setAgentMode(mode)
        return true
      },
      onOpenMarketplace: (mcpServerId?: string) => {
        setMarketplaceFocusServerId(mcpServerId ?? null)
        setView('marketplace')
      },
      onOpenSettings: () => {
        setView('settings')
      },
      onCreateRule: async (title?: string) => {
        if (!activeWorkspace) {
          setSettingsError('Open a workspace to create a rule.')
          return false
        }
        const res = await window.vyotiq.slashCommandsCreateRule({
          workspacePath: activeWorkspace,
          title
        })
        if (!res.ok) {
          setSettingsError(res.error)
          return false
        }
        setSettingsError(null)
        logger.info('Created workspace rule', {
          scope: 'slash',
          path: res.data.relativePath
        })
        return true
      },
      onMarketplaceAction: async (packageId: string, intent: 'install' | 'enable') => {
        if (intent === 'enable') {
          const res = await window.vyotiq.marketplaceSetEnabled(packageId, true)
          if (!res.ok) setSettingsError(res.error)
          return
        }
        const browse = await window.vyotiq.marketplaceBrowse({})
        if (!browse.ok) {
          setSettingsError(browse.error)
          return
        }
        const entry = browse.data.packages.find((p) => p.id === packageId)
        if (!entry) {
          setSettingsError(`Package not found in catalog: ${packageId}`)
          return
        }
        if (entry.installable === false) {
          setSettingsError(`Package is not installable: ${packageId}`)
          return
        }
        const payload =
          entry.bundledPath != null && entry.bundledPath !== ''
            ? {
                source: 'bundled' as const,
                target: entry.bundledPath,
                kind: entry.kind,
                version: entry.version
              }
            : {
                source: 'registry' as const,
                target: entry.id,
                kind: entry.kind,
                version: entry.version
              }
        const res = await window.vyotiq.marketplaceInstall(payload)
        if (!res.ok) setSettingsError(res.error)
      },
      onOpenFile: async (path: string) => {
        if (!activeWorkspace) {
          setSettingsError('Open a workspace to open files.')
          return
        }
        const res = await window.vyotiq.slashCommandsOpenFile({
          workspacePath: activeWorkspace,
          path
        })
        if (!res.ok) setSettingsError(res.error)
      },
      onNotice: (message: string) => {
        setSettingsError(message)
      }
    }),
    [activeWorkspace, onCompactContext, onUndoWrites, setAgentMode]
  )

  const operationalError = settingsError ?? workspaceError

  const [mcpServerNames, setMcpServerNames] = useState(() => new Map<string, string>())

  useEffect(() => {
    const map = new Map<string, string>()
    for (const server of settings.mcpServers) {
      map.set(server.id, server.name.trim() || server.id)
    }
    setMcpServerNames(map)
    let cancelled = false
    void (async () => {
      const res = await window.vyotiq?.mcpStatus?.({
        workspacePath: activeWorkspace
      })
      if (cancelled || !res?.ok) return
      setMcpServerNames((prev) => {
        const next = new Map(prev)
        for (const server of res.data.servers) {
          if (!next.has(server.id)) {
            next.set(server.id, server.name.trim() || server.id)
          }
        }
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [settings.mcpServers, activeWorkspace])

  const onDismissChatBanner = (): void => {
    setSettingsError(null)
    clearWorkspaceError()
    chatActions?.clearError()
  }

  const onOpenRecent = (path: string): void => {
    void addWorkspace(path)
    setView('chat')
  }

  const onRenameRun = async (runId: string, goal: string): Promise<void> => {
    if (!activeWorkspace || !window.vyotiq?.renameRun) return
    const res = await window.vyotiq.renameRun(activeWorkspace, runId, goal)
    if (!res.ok) {
      setSettingsError(res.error)
      return
    }
    refreshActiveRuns()
  }

  const onRenameRunInWorkspace = async (
    path: string,
    runId: string,
    goal: string
  ): Promise<void> => {
    if (!window.vyotiq?.renameRun) return
    const res = await window.vyotiq.renameRun(path, runId, goal)
    if (!res.ok) {
      setSettingsError(res.error)
      return
    }
    refreshWorkspaceRuns(path)
  }

  const onDeleteRun = async (runId: string): Promise<void> => {
    if (!activeWorkspace || !window.vyotiq?.deleteRun) return
    const res = await window.vyotiq.deleteRun(activeWorkspace, runId)
    if (!res.ok) {
      setSettingsError(res.error)
      return
    }
    closeRunTab(runId)
    refreshActiveRuns()
  }

  const onDeleteRunInWorkspace = async (path: string, runId: string): Promise<void> => {
    if (!window.vyotiq?.deleteRun) return
    const res = await window.vyotiq.deleteRun(path, runId)
    if (!res.ok) {
      setSettingsError(res.error)
      return
    }
    if (activeWorkspace && workspacePathsEqual(path, activeWorkspace)) {
      closeRunTab(runId)
    }
    refreshWorkspaceRuns(path)
  }

  const onCloseWorkspace = (path: string): void => {
    void removeWorkspace(path)
  }

  const chatError = chat.error
  const modelsRefreshKey = `${
    settings.provider === 'ollama'
      ? `ollama:${settings.ollamaBaseUrl}`
      : `${settings.provider}:${secrets[settings.provider as SecretProvider] ? '1' : '0'}`
  }:${modelsRefreshNonce}`

  const shellWorkspaceProps = {
    openWorkspaces,
    activeRuns,
    runsByWorkspacePath: Object.fromEntries(
      Object.entries(contexts).map(([path, ctx]) => [
        path,
        {
          runs: ctx.runs,
          runsCapped: ctx.runsCapped,
          runsError: ctx.runsError,
          activeRunId: ctx.activeRunId
        }
      ])
    ),
    onSwitchWorkspace: (path: string) => void switchWorkspace(path),
    onCloseWorkspace,
    onAddWorkspace: onPickWorkspace,
    workspaceHasBackgroundRun,
    onSelectRunInWorkspace: (path: string, runId: string) => void onSelectRunInWorkspace(path, runId),
    onRenameRunInWorkspace: (path: string, runId: string, goal: string) =>
      void onRenameRunInWorkspace(path, runId, goal),
    onDeleteRunInWorkspace: (path: string, runId: string) => void onDeleteRunInWorkspace(path, runId)
  }

  if (loading) {
    return (
      <AppShell
        view="chat"
        workspacePath={null}
        runs={[]}
        activeRunId={null}
        sessionQuery=""
        onSessionQuery={() => {}}
        onOpenSettings={() => {}}
        onOpenMarketplace={() => {}}
        onOpenChat={() => {}}
        onNewChat={() => {}}
        onSelectRun={() => {}}
        onRenameRun={() => {}}
        onDeleteRun={() => {}}
        {...shellWorkspaceProps}
        loading
      >
        <div className="flex min-h-0 flex-1 items-center justify-center px-5">
          <p className="m-0 text-sm tracking-[var(--vy-tracking)] text-muted animate-fade-in">
            Loading Vyotiq…
          </p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      view={view}
      workspacePath={activeWorkspace}
      runs={activeContext?.runs ?? []}
      runsCapped={activeContext?.runsCapped}
      runsError={activeContext?.runsError}
      onDismissRunsError={clearRunsError}
      activeRunId={activeContext?.activeRunId ?? chat.runId}
      sessionQuery=""
      onSessionQuery={setSessionQuery}
      onOpenSettings={() => setView('settings')}
      onOpenMarketplace={() => setView('marketplace')}
      onOpenChat={() => setView('chat')}
      onNewChat={onNewChat}
      onSelectRun={(runId) => void onSelectRun(runId)}
      onRenameRun={(runId, goal) => void onRenameRun(runId, goal)}
      onDeleteRun={(runId) => void onDeleteRun(runId)}
      {...shellWorkspaceProps}
    >
      {view === 'settings' ? (
        <SettingsView
          settings={settings}
          secrets={secrets}
          encryptionAvailable={encryptionAvailable}
          appError={settingsError}
          onDismissAppError={() => setSettingsError(null)}
          backRef={settingsBackRef}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          onClose={() => setView('chat')}
          onUpdate={update}
          onSaveSecret={saveSecret}
          onClearSecret={removeSecret}
          onSetTheme={(theme) => {
            const prev = settings.theme
            setTheme(theme)
            void update({ theme }).then((res) => {
              if (!res.ok) setTheme(prev)
            })
          }}
          onPickWorkspace={async () => {
            const res = await pickWorkspace()
            if (res.ok && res.data) await addWorkspace(res.data)
            return res
          }}
          activeWorkspacePath={activeWorkspace}
          openWorkspaces={openWorkspaces}
          settingsOverridesByPath={registry?.settingsOverridesByPath ?? {}}
          effectiveChatSettings={effectiveChatSettings}
          onSetSettingsOverride={setSettingsOverride}
          onModelsRefreshed={() => setModelsRefreshNonce((n) => n + 1)}
        />
      ) : view === 'marketplace' ? (
        <MarketplaceView
          settings={settings}
          onUpdate={update}
          onReloadSettings={refresh}
          activeWorkspacePath={activeWorkspace}
          settingsOverridesByPath={registry?.settingsOverridesByPath ?? {}}
          onSetSettingsOverride={setSettingsOverride}
          focusServerId={marketplaceFocusServerId}
          onFocusServerConsumed={() => setMarketplaceFocusServerId(null)}
          onClose={() => setView('chat')}
        />
      ) : (
        <ErrorBoundary title="Chat couldn't render" resetKey={chatSurfaceEpoch}>
          <ChatView
            hasOpenWorkspaces={openWorkspaces.length > 0}
            recentPaths={registry?.recentPaths ?? []}
            needsWorkspaceForMigration={registry?.needsWorkspaceForMigration}
            pendingMigrationCount={registry?.pendingMigrationCount}
            items={chat.items}
            itemsStore={{
              subscribeItems: chat.subscribeItems,
              getItemsRevision: chat.getItemsRevision,
              getItems: chat.getItems
            }}
            metaStore={{
              subscribeMeta: chat.subscribeMeta,
              getMetaRevision: chat.getMetaRevision,
              getContextUsage: chat.getContextUsage
            }}
            running={chat.running}
            pendingRun={chat.pendingRun}
            error={chatError}
            runNotice={chat.runNotice}
            incomplete={chat.incomplete}
            onContinue={onChatContinue}
            contextUsage={chat.contextUsage}
            onCompactContext={activeWorkspace && activeRunId ? onCompactContext : undefined}
            operationalError={operationalError}
            hasWorkspace={Boolean(activeWorkspace)}
            workspacePath={activeWorkspace}
            provider={effectiveChatSettings.provider}
            model={effectiveChatSettings.model}
            ollamaBaseUrl={settings.ollamaBaseUrl}
            modelsRefreshKey={modelsRefreshKey}
            activeRunId={chat.runId ?? activeContext?.activeRunId ?? null}
            transcriptLoading={chat.transcriptLoading}
            headingRef={chatHeadingRef}
            onOpenRecent={onOpenRecent}
            onAddWorkspace={onPickWorkspace}
            onProviderModel={onProviderModel}
            favoriteModels={settings.favoriteModels}
            recentModels={settings.recentModels}
            serviceTier={resolveServiceTier(
              settings,
              effectiveChatSettings.provider,
              effectiveChatSettings.model
            )}
            onToggleFavorite={onToggleFavorite}
            onServiceTierChange={onServiceTierChange}
            chatSettings={effectiveChatSettings}
            onChatSettingsChange={onChatSettingsChange}
            agentMode={activeContext?.ui.agentMode ?? 'agent'}
            onAgentModeChange={setAgentMode}
            onContinueInAgent={() => {
              setAgentMode('agent')
              setComposerDraft('Implement the approved plan in plan.md.')
            }}
            onSend={onChatSend}
            onStop={onChatStop}
            onDismissError={onDismissChatBanner}
            onComposerDraftChange={setComposerDraft}
            restoreScrollTop={activeScrollTop}
            scrollRestoreToken={scrollRestoreToken}
            onScrollTopChange={onMessageListScroll}
            chatSurfaceEpoch={chatSurfaceEpoch}
            showThinking={effectiveChatSettings.showThinking}
            onLoadToolContent={onLoadToolContent}
            onThinkingToggle={onThinkingToggle}
            onToolToggle={onToolToggle}
            onGroupToggle={onGroupToggle}
            onTurnToggle={onTurnToggle}
            collapsedTurns={collapsedTurns}
            onApprovalDecision={onApprovalDecision}
            mcpServerNames={mcpServerNames}
            slashHandlers={slashHandlersValue}
            canUndoWrites={Boolean(
              chat.writeCheckpoint && !chat.writeCheckpoint.undone && !chat.running
            )}
            undoBusy={undoBusy}
            onUndoWrites={onUndoWrites}
            writeFileResolutions={writeFileResolutions}
            onKeepWriteFile={onKeepWriteFile}
            onDiscardWriteFile={onDiscardWriteFile}
            onKeepAllWrites={onKeepAllWrites}
          />
        </ErrorBoundary>
      )}
    </AppShell>
  )
}

export default App
