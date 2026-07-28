import { useEffect, useRef, useState } from 'react'
import type { MarketplaceCatalogEntry, Settings, WorkspaceSettingsOverride } from '@shared/ipc'
import { CHAT_GUTTER, MARKETPLACE_COLUMN } from '@renderer/lib/utils/layout'
import { cn } from '@renderer/lib/ui'
import { useMarketplaceController } from './useMarketplaceController'
import { MarketplaceHome } from './MarketplaceHome'
import { MarketplaceDetail } from './MarketplaceDetail'
import { MarketplaceManage } from './MarketplaceManage'

type Pane =
  | { kind: 'home' }
  | { kind: 'detail'; entryId: string; fallback: MarketplaceCatalogEntry }
  | { kind: 'manage' }

export function MarketplaceView({
  settings,
  onUpdate,
  activeWorkspacePath,
  settingsOverridesByPath,
  onSetSettingsOverride,
  onClose
}: {
  settings: Settings
  onUpdate: (partial: Partial<Settings>) => Promise<{ ok: true } | { ok: false; error: string }>
  activeWorkspacePath?: string | null
  settingsOverridesByPath?: Record<string, WorkspaceSettingsOverride>
  onSetSettingsOverride?: (
    path: string,
    override: WorkspaceSettingsOverride | null
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  onClose?: () => void
}) {
  const [pane, setPane] = useState<Pane>({ kind: 'home' })
  const controller = useMarketplaceController({ settings, onUpdate })
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    window.setTimeout(() => closeRef.current?.focus(), 0)
  }, [])

  const detailEntry =
    pane.kind === 'detail'
      ? (controller.catalog.find((e) => e.id === pane.entryId) ?? pane.fallback)
      : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg animate-fade-in">
      <header
        className={cn(
          'flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5'
        )}
      >
        <div className="min-w-0">
          <h1 className="m-0 text-base font-medium tracking-[var(--vy-tracking)] text-fg-strong">
            Marketplace
          </h1>
          <p className="m-0 mt-0.5 text-xs text-secondary">
            MCP servers, skills, and plugins for the agent.
          </p>
        </div>
        {onClose ? (
          <button
            ref={closeRef}
            type="button"
            className="shrink-0 text-sm text-secondary vy-transition hover:text-fg focus-visible:vy-focus-ring"
            onClick={onClose}
          >
            Close
          </button>
        ) : null}
      </header>

      <div className={cn('min-h-0 flex-1 overflow-y-auto', CHAT_GUTTER, 'py-5')}>
        <div className={MARKETPLACE_COLUMN}>
          {pane.kind === 'home' ? (
            <MarketplaceHome
              controller={controller}
              onOpenDetail={(entry) =>
                setPane({ kind: 'detail', entryId: entry.id, fallback: entry })
              }
              onOpenManage={() => setPane({ kind: 'manage' })}
            />
          ) : null}
          {pane.kind === 'detail' && detailEntry ? (
            <MarketplaceDetail
              entry={detailEntry}
              controller={controller}
              onBack={() => setPane({ kind: 'home' })}
            />
          ) : null}
          {pane.kind === 'manage' ? (
            <MarketplaceManage
              controller={controller}
              settings={settings}
              activeWorkspacePath={activeWorkspacePath}
              settingsOverridesByPath={settingsOverridesByPath}
              onSetSettingsOverride={onSetSettingsOverride}
              onBack={() => setPane({ kind: 'home' })}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
