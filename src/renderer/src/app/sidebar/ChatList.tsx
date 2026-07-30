import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { ChatRow } from './ChatRow'
import type { WorkspaceSidebarGroup } from './types'

function WorkspaceHeader({
  name,
  active,
  expanded,
  hasActivity,
  onToggle,
  onSelectWorkspace,
  onCloseWorkspace
}: {
  name: string
  active: boolean
  expanded: boolean
  hasActivity: boolean
  onToggle: () => void
  onSelectWorkspace: () => void
  onCloseWorkspace: () => void
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md px-1.5 py-1 text-xs',
        active ? 'bg-surface text-fg' : 'text-muted hover:bg-surface/60 hover:text-fg'
      )}
    >
      <button
        type="button"
        className="app-region-no-drag inline-grid size-5 place-items-center rounded vy-transition hover:bg-bg"
        aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        <span className="relative inline-flex size-4 items-center justify-center">
          <Icon
            name="folder"
            size={12}
            className="absolute opacity-70 group-hover:opacity-0 vy-transition"
            aria-hidden="true"
          />
          <Icon
            name={expanded ? 'chevron' : 'chevronRight'}
            size={12}
            className="absolute opacity-0 group-hover:opacity-100 vy-transition"
            aria-hidden="true"
          />
        </span>
      </button>
      <button
        type="button"
        className="app-region-no-drag flex min-w-0 flex-1 items-center gap-1 text-left"
        onClick={onSelectWorkspace}
      >
        {hasActivity ? (
          <span className="size-1 shrink-0 rounded-full bg-fg motion-safe:animate-pulse" aria-hidden />
        ) : null}
        <span className="truncate font-medium">{name}</span>
      </button>
      <button
        type="button"
        className="app-region-no-drag inline-grid size-5 place-items-center rounded text-muted opacity-0 vy-transition hover:bg-bg hover:text-danger group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        title={`Close ${name}`}
        aria-label={`Close ${name}`}
        onClick={(e) => {
          e.stopPropagation()
          onCloseWorkspace()
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

export function ChatList({
  workspaceReady,
  sessionQuery,
  filteredRunsCount,
  workspaceGroups,
  onToggleWorkspace,
  onSwitchWorkspace,
  onCloseWorkspace,
  onAddWorkspace,
  workspaceHasBackgroundRun,
  onDismissRunsError,
  onSelectRun,
  onRenameRun,
  onDeleteRun
}: {
  workspaceReady: boolean
  sessionQuery: string
  filteredRunsCount: number
  workspaceGroups: WorkspaceSidebarGroup[]
  onToggleWorkspace: (path: string) => void
  onSwitchWorkspace: (path: string) => void
  onCloseWorkspace: (path: string) => void
  onAddWorkspace: () => void
  workspaceHasBackgroundRun: (path: string) => boolean
  onDismissRunsError?: (path: string) => void
  onSelectRun: (path: string, runId: string) => void
  onRenameRun: (path: string, runId: string, goal: string) => void
  onDeleteRun: (path: string, runId: string) => void
}) {
  return (
    <div className="px-1 pt-0.5 pb-1.5" role="region" aria-label="Workspace sessions">
      {!workspaceReady ? (
        <p className="m-0 px-1 py-5 text-center text-[13px] text-muted">
          Open a workspace to see chats
        </p>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between px-1">
            <p className="m-0 text-[10px] uppercase tracking-wide text-muted">Workspaces</p>
            <button
              type="button"
              className="app-region-no-drag inline-grid size-6 place-items-center rounded text-muted vy-transition hover:bg-surface hover:text-fg"
              aria-label="Add workspace"
              title="Add workspace"
              onClick={onAddWorkspace}
            >
              <Icon name="folderPlus" size={14} />
            </button>
          </div>

          {filteredRunsCount === 0 && sessionQuery.trim() ? (
            <p className="m-0 px-1 py-5 text-center text-[13px] text-muted">No matching chats</p>
          ) : null}

          <div className="flex flex-col gap-2 pb-0.5">
            {workspaceGroups.map((workspace) => (
              <div key={workspace.path} className="flex flex-col gap-1">
                <WorkspaceHeader
                  name={workspace.label}
                  active={workspace.isActiveWorkspace}
                  expanded={workspace.expanded}
                  hasActivity={workspaceHasBackgroundRun(workspace.path)}
                  onToggle={() => onToggleWorkspace(workspace.path)}
                  onSelectWorkspace={() => onSwitchWorkspace(workspace.path)}
                  onCloseWorkspace={() => onCloseWorkspace(workspace.path)}
                />

                {workspace.runsError ? (
                  <div
                    className="ml-4 mr-1 flex items-start gap-2 rounded-md border border-danger/20 bg-danger/5 px-2 py-1.5"
                    role="alert"
                  >
                    <p className="m-0 min-w-0 flex-1 text-xs text-danger">{workspace.runsError}</p>
                    {onDismissRunsError ? (
                      <button
                        type="button"
                        className="shrink-0 text-xs text-muted vy-transition hover:text-fg"
                        onClick={() => onDismissRunsError(workspace.path)}
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {workspace.expanded ? (
                  workspace.filteredRuns.length === 0 ? (
                    <p className="m-0 ml-4 px-1 py-1 text-[11px] text-muted">
                      {sessionQuery.trim() ? 'No matching chats' : 'No chats yet'}
                    </p>
                  ) : (
                    <div className="ml-4 flex flex-col gap-2">
                      {workspace.groupedRuns.map((group) => (
                        <div key={`${workspace.path}:${group.id}`}>
                          {(workspace.groupedRuns.length > 1 || group.label === 'Results') && (
                            <p className="sticky top-0 z-sticky m-0 bg-bg/95 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted backdrop-blur-sm">
                              {group.label}
                            </p>
                          )}
                          <div className="flex flex-col gap-px" role="list">
                            {group.runs.map((run) => (
                              <ChatRow
                                key={`${workspace.path}:${run.runId}`}
                                run={run}
                                active={workspace.activeRunId === run.runId}
                                onSelect={() => onSelectRun(workspace.path, run.runId)}
                                onRename={(goal) => onRenameRun(workspace.path, run.runId, goal)}
                                onDelete={() => onDeleteRun(workspace.path, run.runId)}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : null}

                {workspace.runsCapped && !sessionQuery.trim() ? (
                  <p className="m-0 ml-4 px-1 py-1.5 text-[9px] text-muted">Showing 30 most recent</p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
