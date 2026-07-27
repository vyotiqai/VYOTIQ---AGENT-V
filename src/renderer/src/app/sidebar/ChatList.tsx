import type { RunSummary } from '@shared/ipc'
import type { RunRecencyGroup } from '@renderer/lib/utils/groupRunsByRecency'
import { ChatRow } from './ChatRow'

export function ChatList({
  workspaceReady,
  sessionQuery,
  filteredRuns,
  groupedRuns,
  runsCapped,
  runsError,
  onDismissRunsError,
  activeRunId,
  onSelectRun,
  onRenameRun,
  onDeleteRun
}: {
  workspaceReady: boolean
  sessionQuery: string
  filteredRuns: RunSummary[]
  groupedRuns: RunRecencyGroup[]
  runsCapped?: boolean
  runsError?: string | null
  onDismissRunsError?: () => void
  activeRunId: string | null
  onSelectRun: (runId: string) => void
  onRenameRun: (runId: string, goal: string) => void
  onDeleteRun: (runId: string) => void
}) {
  return (
    <div className="px-1 pt-0.5 pb-1.5" role="region" aria-label="Chats">
      {runsError ? (
        <div
          className="mb-2 flex items-start gap-2 rounded-md border border-danger/20 bg-danger/5 px-2 py-1.5"
          role="alert"
        >
          <p className="m-0 min-w-0 flex-1 text-xs text-danger">{runsError}</p>
          {onDismissRunsError ? (
            <button
              type="button"
              className="shrink-0 text-xs text-muted vy-transition hover:text-fg"
              onClick={onDismissRunsError}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      {filteredRuns.length === 0 ? (
        <p className="m-0 px-1 py-5 text-center text-[13px] text-muted">
          {!workspaceReady
            ? 'Open a workspace to see chats'
            : sessionQuery.trim()
              ? 'No matching chats'
              : 'No chats yet'}
        </p>
      ) : (
        <div className="flex flex-col gap-2 pb-0.5">
          {groupedRuns.map((group) => (
            <div key={group.id}>
              {(groupedRuns.length > 1 || group.label === 'Results') && (
                <p className="sticky top-0 z-sticky m-0 bg-bg/95 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted backdrop-blur-sm">
                  {group.label}
                </p>
              )}
              <div className="flex flex-col gap-px" role="list">
                {group.runs.map((run) => (
                  <ChatRow
                    key={run.runId}
                    run={run}
                    active={activeRunId === run.runId}
                    onSelect={() => onSelectRun(run.runId)}
                    onRename={(goal) => onRenameRun(run.runId, goal)}
                    onDelete={() => onDeleteRun(run.runId)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {runsCapped && !sessionQuery.trim() ? (
        <p className="m-0 px-1 py-1.5 text-center text-[9px] text-muted">Showing 30 most recent</p>
      ) : null}
    </div>
  )
}
