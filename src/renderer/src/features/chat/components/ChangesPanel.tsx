import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, cn } from '@renderer/lib/ui'
import { Icon } from '@renderer/lib/icons'
import { CHAT_RIGHT_PANEL_BODY } from '@renderer/lib/utils/layout'
import type { GitChangedFile, GitStatus } from '@shared/ipc'
import type { UiItem } from '@shared/transcript'
import { ChangeSummary } from './ChangeSummary'
import { EmptyPanel } from './PanelChrome'
import { DiffPreview } from './DiffPreview'
import { FileBadge } from './FileBadge'
import { useGitChrome } from './GitChrome'
import { basename, parseUnifiedDiff, type DiffLine } from '../toolUi'
import {
  collectSessionChangedFiles,
  collectSessionFileDiffs
} from '../utils/turnFileDiffs'

type ChangeScope = 'agent' | 'uncommitted' | 'staged' | 'unstaged'

const SCOPE_LABEL: Record<ChangeScope, string> = {
  agent: 'Last Agent Turn',
  uncommitted: 'Uncommitted',
  staged: 'Staged',
  unstaged: 'Unstaged'
}

function statusBadge(status: GitChangedFile['status']): string {
  switch (status) {
    case 'added':
    case 'untracked':
      return 'New'
    case 'deleted':
      return 'Deleted'
    case 'modified':
      return 'Modified'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

function GitFileRow({
  workspacePath,
  file,
  staged,
  wordWrap,
  expanded,
  onToggle
}: {
  workspacePath: string
  file: GitChangedFile
  staged: boolean
  wordWrap: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const [lines, setLines] = useState<DiffLine[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setLoading(true)
    void window.vyotiq
      .gitDiff({ workspacePath, path: file.path, staged })
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setLines([])
          return
        }
        setLines(parseUnifiedDiff(res.data.content))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, workspacePath, file.path, staged])

  return (
    <li className="min-w-0 border-b border-border/40 last:border-b-0">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface/60"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="shrink-0 text-tertiary">{expanded ? '▾' : '▸'}</span>
        <FileBadge path={file.path} />
        <span className="min-w-0 flex-1 truncate text-fg" title={file.path}>
          {file.path}
        </span>
        <span className="shrink-0 tabular-nums">
          {file.added > 0 ? <span className="text-success">+{file.added}</span> : null}
          {file.removed > 0 ? (
            <span className="ml-1 text-danger">-{file.removed}</span>
          ) : null}
        </span>
        <span
          className={cn(
            'shrink-0 text-[10px]',
            file.status === 'added' || file.status === 'untracked'
              ? 'text-success'
              : 'text-muted'
          )}
        >
          {statusBadge(file.status)}
        </span>
      </button>
      {expanded ? (
        <div
          className={cn(
            'border-t border-border/40 bg-surface-2/30 px-2 py-1',
            wordWrap && '[&_pre]:whitespace-pre-wrap'
          )}
        >
          {loading ? (
            <p className="m-0 px-1 py-1 text-[11px] text-muted">Loading diff…</p>
          ) : lines && lines.length > 0 ? (
            <DiffPreview lines={lines} path={file.path} expanded />
          ) : (
            <p className="m-0 px-1 py-1 text-[11px] text-muted">
              {file.binary ? 'Binary file' : 'No textual diff'}
            </p>
          )}
        </div>
      ) : null}
    </li>
  )
}

/**
 * Docked Changes panel: git working tree + agent Keep/Discard rollup.
 */
export function ChangesPanel({
  items,
  className,
  workspacePath,
  gitRevision = 0,
  onViewPr,
  writeFileResolutions,
  resolvablePaths,
  canResolve,
  resolveBusy,
  onKeepWriteFile,
  onDiscardWriteFile,
  onKeepAllWrites,
  onDiscardAllWrites
}: {
  items: UiItem[]
  className?: string
  workspacePath?: string | null
  gitRevision?: number
  onViewPr?: () => void
  writeFileResolutions?: ReadonlyMap<string, 'kept' | 'discarded' | undefined>
  resolvablePaths?: ReadonlySet<string>
  canResolve?: boolean
  resolveBusy?: boolean
  onKeepWriteFile?: (path: string) => void | Promise<unknown>
  onDiscardWriteFile?: (path: string) => void | Promise<unknown>
  onKeepAllWrites?: () => void | Promise<unknown>
  onDiscardAllWrites?: () => void | Promise<unknown>
}) {
  const chrome = useGitChrome(workspacePath ?? null, gitRevision, Boolean(workspacePath))
  const agentFiles = useMemo(() => collectSessionChangedFiles(items), [items])
  const agentDiffs = useMemo(() => collectSessionFileDiffs(items), [items])

  const [scope, setScope] = useState<ChangeScope>('uncommitted')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [wordWrap, setWordWrap] = useState(false)
  const [composing, setComposing] = useState(false)
  const [message, setMessage] = useState('')
  const [pushOpen, setPushOpen] = useState(false)

  const status: GitStatus | null = chrome.status
  const gitFiles = status?.files ?? []

  const visibleGitFiles = useMemo(() => {
    // Approximate until porcelain XY stage flags ship: untracked → unstaged only;
    // deleted/added/modified can appear in either staged or unstaged views.
    switch (scope) {
      case 'agent':
        return []
      case 'staged':
        return gitFiles.filter((f) => f.status !== 'untracked')
      case 'unstaged':
        return gitFiles.filter(
          (f) =>
            f.status === 'untracked' || f.status === 'modified' || f.status === 'deleted'
        )
      case 'uncommitted':
        return gitFiles
      default: {
        const _exhaustive: never = scope
        return _exhaustive
      }
    }
  }, [gitFiles, scope])

  const totals = useMemo(() => {
    if (scope === 'agent') {
      return {
        files: agentFiles.length,
        added: agentFiles.reduce((s, f) => s + f.added, 0),
        removed: agentFiles.reduce((s, f) => s + f.removed, 0)
      }
    }
    return {
      files: visibleGitFiles.length,
      added: visibleGitFiles.reduce((s, f) => s + f.added, 0),
      removed: visibleGitFiles.reduce((s, f) => s + f.removed, 0)
    }
  }, [scope, agentFiles, visibleGitFiles])

  const togglePath = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const sendCommit = useCallback(
    (push: boolean) => {
      void chrome.commit(message, push).then((ok) => {
        if (!ok) return
        setMessage('')
        setComposing(false)
        setPushOpen(false)
      })
    },
    [chrome, message]
  )

  const empty =
    scope === 'agent' ? agentFiles.length === 0 : visibleGitFiles.length === 0 && !chrome.busy

  const commitPrimaryPushes = Boolean(status?.hasRemote)

  return (
    <div
      className={cn(CHAT_RIGHT_PANEL_BODY, className)}
      data-changes-panel
      role="region"
      aria-label="Files changed panel"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-2 py-1.5">
        <div className="relative">
          <button
            type="button"
            className="inline-flex max-w-[10rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-fg hover:bg-surface-2"
            onClick={() => setScopeOpen((v) => !v)}
            aria-expanded={scopeOpen}
          >
            <Icon name="branch" size={12} className="shrink-0 text-muted" />
            <span className="truncate">{SCOPE_LABEL[scope]}</span>
            <Icon name="chevron" size={10} className="shrink-0 text-muted" />
          </button>
          {scopeOpen ? (
            <div className="absolute left-0 top-full z-dropdown mt-0.5 min-w-[11rem] rounded-md border border-border bg-bg py-1 shadow-lg">
              {(Object.keys(SCOPE_LABEL) as ChangeScope[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-surface',
                    scope === key ? 'text-fg' : 'text-muted'
                  )}
                  onClick={() => {
                    setScope(key)
                    setScopeOpen(false)
                  }}
                >
                  {SCOPE_LABEL[key]}
                  {scope === key ? <Icon name="check" size={12} className="ml-auto" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <span className="tabular-nums text-[11px] text-muted">
          {totals.added > 0 ? <span className="text-success">+{totals.added}</span> : null}
          {totals.removed > 0 ? (
            <span className="ml-1 text-danger">-{totals.removed}</span>
          ) : null}
          {status?.branch ? (
            <span className="ml-1.5 max-w-[8rem] truncate" title={status.branch}>
              {status.branch}
            </span>
          ) : null}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-fg"
              aria-label="More changes actions"
              onClick={() => setMenuOpen((v) => !v)}
            >
              ···
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-dropdown mt-0.5 min-w-[12rem] rounded-md border border-border bg-bg py-1 shadow-lg">
                <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-fg">
                  Word wrap
                  <input
                    type="checkbox"
                    checked={wordWrap}
                    onChange={(e) => setWordWrap(e.target.checked)}
                  />
                </label>
                <button
                  type="button"
                  className="flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                  onClick={() => {
                    setExpanded(new Set())
                    setMenuOpen(false)
                  }}
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  className="flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                  onClick={() => {
                    chrome.refresh()
                    setMenuOpen(false)
                  }}
                >
                  Refresh changes
                </button>
              </div>
            ) : null}
          </div>

          {onViewPr ? (
            <Button
              variant="subtle"
              className="h-6 px-2 text-[11px]"
              onClick={onViewPr}
            >
              View PR
            </Button>
          ) : null}

          {scope !== 'agent' && status && status.fileCount > 0 ? (
            <div className="relative flex items-center">
              {composing ? (
                <input
                  type="text"
                  value={message}
                  autoFocus
                  className="mr-1 w-28 rounded-md border border-border bg-bg px-1.5 py-0.5 text-[11px] text-fg outline-none"
                  placeholder="Commit message"
                  aria-label="Commit message"
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendCommit(commitPrimaryPushes)
                    if (e.key === 'Escape') setComposing(false)
                  }}
                />
              ) : null}
              <Button
                variant="subtle"
                className="h-6 rounded-r-none px-2 text-[11px]"
                disabled={chrome.busy || (composing && !message.trim())}
                onClick={() => {
                  if (!composing) {
                    setMessage(
                      status.fileCount === 1 && status.files[0]
                        ? `Update ${basename(status.files[0].path)}`
                        : `Update ${status.fileCount} files`
                    )
                    setComposing(true)
                    return
                  }
                  sendCommit(commitPrimaryPushes)
                }}
              >
                {commitPrimaryPushes ? 'Commit & Push' : 'Commit'}
              </Button>
              {status.hasRemote ? (
                <>
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-r-md border border-l-0 border-border bg-surface px-1 text-muted hover:bg-surface-2"
                    aria-label="Commit options"
                    onClick={() => setPushOpen((v) => !v)}
                  >
                    <Icon name="chevron" size={10} />
                  </button>
                  {pushOpen ? (
                    <div className="absolute right-0 top-full z-dropdown mt-0.5 min-w-[9rem] rounded-md border border-border bg-bg py-1 shadow-lg">
                      <button
                        type="button"
                        className="flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                        disabled={chrome.busy || !message.trim()}
                        onClick={() => sendCommit(false)}
                      >
                        Commit
                      </button>
                      <button
                        type="button"
                        className="flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                        disabled={chrome.busy || !message.trim()}
                        onClick={() => sendCommit(true)}
                      >
                        Commit &amp; Push
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {chrome.notice ? (
        <p
          className={cn(
            'm-0 shrink-0 border-b border-border/40 px-3 py-1 text-[11px]',
            chrome.noticeFailed ? 'text-danger' : 'text-secondary'
          )}
          role={chrome.noticeFailed ? 'alert' : 'status'}
        >
          {chrome.notice}
        </p>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-2">
        {!workspacePath ? (
          <EmptyPanel
            icon="branch"
            title="No workspace"
            body="Open a workspace to view git changes and resolve agent edits."
          />
        ) : empty ? (
          <EmptyPanel
            icon="branch"
            title="No changes yet"
            body={
              scope === 'agent'
                ? 'Agent edits will appear here with Keep / Discard when available.'
                : 'Working tree changes will appear here when files differ from HEAD.'
            }
          />
        ) : scope === 'agent' ? (
          <ChangeSummary
            files={agentFiles}
            fileDiffs={agentDiffs}
            fileResolutions={writeFileResolutions}
            resolvablePaths={resolvablePaths}
            canResolve={canResolve}
            resolveBusy={resolveBusy}
            onKeepFile={onKeepWriteFile}
            onDiscardFile={onDiscardWriteFile}
            onKeepAll={onKeepAllWrites}
            onDiscardAll={onDiscardAllWrites}
          />
        ) : (
          <ul className="m-0 list-none overflow-hidden rounded-md border border-border/50 bg-surface p-0">
            <li className="border-b border-border/40 px-3 py-1.5 text-[11px] text-fg">
              {totals.files} {totals.files === 1 ? 'File Changed' : 'Files Changed'}
              {totals.added > 0 ? (
                <span className="ml-2 text-success">+{totals.added}</span>
              ) : null}
              {totals.removed > 0 ? (
                <span className="ml-1 text-danger">-{totals.removed}</span>
              ) : null}
            </li>
            {visibleGitFiles.map((file) => (
              <GitFileRow
                key={file.path}
                workspacePath={workspacePath}
                file={file}
                staged={scope === 'staged'}
                wordWrap={wordWrap}
                expanded={expanded.has(file.path)}
                onToggle={() => togglePath(file.path)}
              />
            ))}
          </ul>
        )}

        {workspacePath && scope !== 'agent' && agentFiles.length > 0 && canResolve ? (
          <div className="mt-3">
            <p className="m-0 mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              Agent edits
            </p>
            <ChangeSummary
              files={agentFiles}
              fileDiffs={agentDiffs}
              fileResolutions={writeFileResolutions}
              resolvablePaths={resolvablePaths}
              canResolve={canResolve}
              resolveBusy={resolveBusy}
              onKeepFile={onKeepWriteFile}
              onDiscardFile={onDiscardWriteFile}
              onKeepAll={onKeepAllWrites}
              onDiscardAll={onDiscardAllWrites}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
