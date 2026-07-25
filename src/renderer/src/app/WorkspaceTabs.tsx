import { Icon } from '@renderer/lib/icons'
import { NavItem, cn } from '@renderer/lib/ui'
import { formatWorkspaceName } from '@renderer/lib/utils/formatWorkspaceName'
import { handleTabListKeyDown } from '@renderer/lib/utils/tabListKeyboard'
import { workspacePathsEqual } from '@shared/workspacePathMatch'

function workspaceIsActive(
  path: string,
  activeRuns: { runId: string; workspacePath: string }[],
  workspaceHasBackgroundRun: (path: string) => boolean
): boolean {
  return (
    workspaceHasBackgroundRun(path) ||
    activeRuns.some((r) => workspacePathsEqual(r.workspacePath, path))
  )
}

export function WorkspaceTabs({
  openPaths,
  activePath,
  activeRuns,
  onSwitch,
  onClose,
  onAdd,
  workspaceHasBackgroundRun,
  collapsed = false
}: {
  openPaths: string[]
  activePath: string | null
  activeRuns: { runId: string; workspacePath: string }[]
  onSwitch: (path: string) => void
  onClose: (path: string) => void
  onAdd: () => void
  workspaceHasBackgroundRun: (path: string) => boolean
  /** Icon-only rail for collapsed desktop sidebar. */
  collapsed?: boolean
}) {
  if (collapsed) {
    if (openPaths.length === 0) return null

    return (
      <div
        className="flex flex-col items-center gap-0.5"
        role="tablist"
        aria-label="Workspaces"
        aria-orientation="vertical"
        onKeyDown={(e) =>
          handleTabListKeyDown(e, {
            tabs: openPaths,
            activeId: activePath,
            onSelect: onSwitch
          })
        }
      >
        {openPaths.map((path) => {
          const active = path === activePath
          const name = formatWorkspaceName(path, path)
          const showDot = workspaceIsActive(path, activeRuns, workspaceHasBackgroundRun)
          return (
            <button
              key={path}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={cn(
                'relative inline-grid size-8 place-items-center rounded-md vy-transition',
                active
                  ? 'bg-surface text-fg-strong'
                  : 'text-secondary hover:bg-surface/70 hover:text-fg'
              )}
              title={`${name} — right-click or Shift+Click to close`}
              aria-label={name}
              onClick={(e) => {
                if (e.shiftKey) {
                  e.preventDefault()
                  if (showDot) {
                    const ok = window.confirm(
                      `${name} has chats running in the background. Close this workspace anyway?`
                    )
                    if (!ok) return
                  }
                  onClose(path)
                  return
                }
                onSwitch(path)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                if (showDot) {
                  const ok = window.confirm(
                    `${name} has chats running in the background. Close this workspace anyway?`
                  )
                  if (!ok) return
                }
                onClose(path)
              }}
            >
              <Icon name="folder" size={15} />
              {showDot ? (
                <span
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-secondary motion-safe:animate-pulse"
                  aria-hidden
                />
              ) : null}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-px">
      {openPaths.length > 0 ? (
        <div
          className="flex flex-col gap-px"
          role="tablist"
          aria-label="Workspaces"
          onKeyDown={(e) =>
            handleTabListKeyDown(e, {
              tabs: openPaths,
              activeId: activePath,
              onSelect: onSwitch
            })
          }
        >
          {openPaths.map((path) => {
            const active = path === activePath
            const name = formatWorkspaceName(path, path)
            const showDot = workspaceIsActive(path, activeRuns, workspaceHasBackgroundRun)
            return (
              <div
                key={path}
                role="presentation"
                className={cn(
                  'group flex w-full min-w-0 items-center gap-0.5 rounded-md vy-transition',
                  active
                    ? 'bg-surface-2 text-fg-strong'
                    : 'text-secondary hover:bg-surface hover:text-fg'
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-[7px] text-left text-sm tracking-[var(--vy-tracking)]"
                  title={path}
                  onClick={() => onSwitch(path)}
                >
                  {showDot ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-secondary motion-safe:animate-pulse"
                      aria-hidden
                    />
                  ) : (
                    <Icon name="folder" size={13} className="shrink-0 opacity-70" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  className="mr-0.5 inline-grid size-6 shrink-0 place-items-center rounded vy-transition text-muted opacity-0 hover:bg-surface-2 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                  aria-label={`Close ${name}`}
                  title={`Close ${name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (showDot) {
                      const ok = window.confirm(
                        `${name} has chats running in the background. Close this workspace anyway?`
                      )
                      if (!ok) return
                    }
                    onClose(path)
                  }}
                >
                  <Icon name="close" size={10} />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="m-0 px-2.5 py-1.5 text-sm text-secondary">No workspace open</p>
      )}

      <NavItem label="Add workspace" icon="folderPlus" onClick={onAdd} dense />
    </div>
  )
}
