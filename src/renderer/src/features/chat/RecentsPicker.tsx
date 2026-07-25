import { Button } from '@renderer/lib/ui'
import { formatWorkspaceName } from '@renderer/lib/utils/formatWorkspaceName'
import { CHAT_COLUMN, CHAT_COLUMN_MAX, CHAT_GUTTER } from '@renderer/lib/utils/layout'
import { cn } from '@renderer/lib/ui/cn'

export function RecentsPicker({
  recentPaths,
  needsWorkspaceForMigration,
  pendingMigrationCount = 0,
  onOpenRecent,
  onAddWorkspace
}: {
  recentPaths: string[]
  needsWorkspaceForMigration?: boolean
  pendingMigrationCount?: number
  onOpenRecent: (path: string) => void
  onAddWorkspace: () => void
}) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col items-center justify-center', CHAT_GUTTER)}>
      <div className={cn('w-full', CHAT_COLUMN, CHAT_COLUMN_MAX)}>
        <h2 className="m-0 text-title font-semibold text-fg-strong">Open a workspace</h2>
        <p className="mt-2 text-sm text-secondary">
          Pick a project folder to start chatting with Vyotiq.
        </p>

        {needsWorkspaceForMigration ? (
          <p className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-sm text-secondary">
            {pendingMigrationCount > 0
              ? `${pendingMigrationCount} legacy chat run(s) can be migrated after you open a workspace.`
              : 'Open a workspace to finish migrating legacy chats.'}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2">
          {recentPaths.length ? (
            recentPaths.map((path) => (
              <button
                key={path}
                type="button"
                className="rounded-md border border-border bg-surface px-3 py-2 text-left text-sm text-fg hover:bg-surface-2"
                onClick={() => onOpenRecent(path)}
              >
                <span className="block font-medium text-fg-strong">
                  {formatWorkspaceName(path, path)}
                </span>
                <span className="mt-0.5 block truncate text-xs text-tertiary">{path}</span>
              </button>
            ))
          ) : (
            <p className="text-sm text-secondary">No recent workspaces yet.</p>
          )}
        </div>

        <div className="mt-6">
          <Button type="button" onClick={onAddWorkspace}>
            Add workspace
          </Button>
        </div>
      </div>
    </div>
  )
}
