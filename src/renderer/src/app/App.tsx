import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppShell } from './AppShell'
import { ChatView } from '../features/chat/ChatView'
import { SettingsView, type SettingsSection } from '../features/settings'
import { useTheme } from '@renderer/lib/hooks/useTheme'
import { useSettings } from '@renderer/lib/hooks/useSettings'
import { useWorkspaceManager } from '@renderer/lib/hooks/useWorkspaceManager'
import type { ProviderId, SecretProvider, ServiceTier } from '@shared/ipc'
import { defaultModelFor } from '@shared/providers'
import {
  resolveEffectiveSettings,
  type ChatSettingsPatch
} from '@shared/effectiveSettings'
import {
  DEFAULT_THINKING_PREFS,
  modelSelectionKey,
  pushRecentModel
} from '@shared/domain/modelSelection'
import { logger } from '@shared/logger'

/** Sent as a visible user turn when resuming a run that was cut short. */
const CONTINUE_PROMPT = 'Continue from where you stopped.'

export function App() {
  const {
    settings,
    secrets,
    encryptionAvailable,
    loading,
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
    activeController,
    activeRuns,
    chat,
    chatActions,
    openRunTab,
    closeRunTab,
    setSessionQuery,
    addWorkspace,
    switchWorkspace,
    removeWorkspace,
    getRunController,
    loadRunIntoTab: loadRunTranscriptIntoTab,
    refreshActiveRuns,
    workspaceHasBackgroundRun,
    scrollRestoreToken,
    setComposerDraft,
    onMessageListScroll,
    setSettingsOverride,
    workspaceError,
    clearWorkspaceError,
    clearRunsError,
    activeScrollTop,
    chatSurfaceEpoch
  } = workspace

  const [view, setView] = useState<'chat' | 'settings'>('chat')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [modelsRefreshNonce, setModelsRefreshNonce] = useState(0)
  const [harnessActive, setHarnessActive] = useState(false)
  const chatHeadingRef = useRef<HTMLHeadingElement>(null)
  const settingsBackRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (view === 'settings') {
      window.setTimeout(() => settingsBackRef.current?.focus(), 0)
    } else {
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
        model: resolvedModel
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

  const onSelectRunTab = async (runId: string): Promise<void> => {
    openRunTab(runId)
    const ctrl = getRunController(runId)
    if (!ctrl || ctrl.items.length === 0) {
      await loadRunIntoTab(runId)
    }
  }

  const onNewChat = (): void => {
    openRunTab(null)
    setView('chat')
  }

  const onOpenHarness = async (): Promise<void> => {
    setSettingsError(null)
    const res = await window.vyotiq.openHarness()
    if (!res.ok) {
      logger.warn('openHarness failed', { scope: 'harness', err: res.error })
      setSettingsError(res.error)
      return
    }
    setHarnessActive(true)
    window.setTimeout(() => setHarnessActive(false), 2000)
  }

  const onPickWorkspace = (): void => {
    void pickWorkspace().then(async (res) => {
      if (res.ok && res.data) {
        await addWorkspace(res.data)
      }
    })
  }

  const operationalError = settingsError ?? workspaceError

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
    onSwitchWorkspace: (path: string) => void switchWorkspace(path),
    onCloseWorkspace,
    onAddWorkspace: onPickWorkspace,
    workspaceHasBackgroundRun
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
        onOpenChat={() => {}}
        onOpenHarness={() => {}}
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
      sessionQuery={activeContext?.sessionQuery ?? ''}
      harnessActive={harnessActive}
      onSessionQuery={setSessionQuery}
      onOpenSettings={() => setView('settings')}
      onOpenChat={() => setView('chat')}
      onOpenHarness={() => void onOpenHarness()}
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
      ) : (
        <ChatView
          hasOpenWorkspaces={openWorkspaces.length > 0}
          recentPaths={registry?.recentPaths ?? []}
          needsWorkspaceForMigration={registry?.needsWorkspaceForMigration}
          pendingMigrationCount={registry?.pendingMigrationCount}
          items={chat.items}
          running={chat.running}
          error={chatError}
          runNotice={chat.runNotice}
          incomplete={chat.incomplete}
          onContinue={() => void chatActions?.send(CONTINUE_PROMPT)}
          contextUsage={chat.contextUsage}
          onCompactContext={
            activeWorkspace && chat.runId
              ? async () => {
                  const res = await window.vyotiq.chatCompact(activeWorkspace, chat.runId!)
                  if (!res.ok) return { ok: false as const, message: res.error }
                  return {
                    ok: true as const,
                    message: `Summarized ${res.data.messagesBefore - res.data.keptMessages} messages; ${res.data.keptMessages} kept verbatim.`
                  }
                }
              : undefined
          }
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
          serviceTier={settings.serviceTier}
          onToggleFavorite={onToggleFavorite}
          onServiceTierChange={onServiceTierChange}
          chatSettings={effectiveChatSettings}
          onChatSettingsChange={onChatSettingsChange}
          onSend={async (text, images, files) => {
            return chatActions?.send(text, images, files) ?? false
          }}
          onStop={() => void chatActions?.stop()}
          onDismissError={onDismissChatBanner}
          composerDraft={activeContext?.ui.composerDraft}
          onComposerDraftChange={setComposerDraft}
          restoreScrollTop={activeScrollTop}
          scrollRestoreToken={scrollRestoreToken}
          onScrollTopChange={onMessageListScroll}
          chatSurfaceEpoch={chatSurfaceEpoch}
          showThinking={effectiveChatSettings.showThinking}
          onLoadToolContent={
            activeController
              ? (toolCallId) => activeController.loadToolContent(toolCallId)
              : undefined
          }
          onThinkingToggle={
            activeController
              ? (messageId, expanded) => activeController.setThinkingExpanded(messageId, expanded)
              : undefined
          }
          onToolToggle={
            activeController
              ? (toolCallId, expanded) => activeController.setToolExpanded(toolCallId, expanded)
              : undefined
          }
          onGroupToggle={
            activeController
              ? (anchorId, expanded) => activeController.setGroupExpanded(anchorId, expanded)
              : undefined
          }
          onApprovalDecision={
            activeController
              ? (requestId, decision) => activeController.respondToApproval(requestId, decision)
              : undefined
          }
        />
      )}
    </AppShell>
  )
}

export default App
