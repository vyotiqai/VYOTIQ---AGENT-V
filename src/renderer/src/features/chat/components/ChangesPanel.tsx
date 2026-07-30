import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, cn, IconButton, Switch } from '@renderer/lib/ui'
import { Icon, type IconName } from '@renderer/lib/icons'
import { CHAT_RIGHT_PANEL_BODY } from '@renderer/lib/utils/layout'
import type { GitChangedFile, GitLogEntry, GitStatus } from '@shared/ipc'
import type { UiItem } from '@shared/transcript'
import { ChangeSummary } from './ChangeSummary'
import { EmptyPanel } from './PanelChrome'
import { DiffPreview, type DiffLayout } from './DiffPreview'
import { FileBadge } from './FileBadge'
import { useGitChrome } from './GitChrome'
import { CommitComposer, defaultCommitMessage } from './CommitComposer'
import { basename, parseUnifiedDiff, type DiffLine } from '../toolUi'
import {
  collectSessionChangedFiles,
  collectSessionFileDiffs
} from '../utils/turnFileDiffs'

type ChangeScope = 'agent' | 'uncommitted' | 'staged' | 'unstaged' | 'commits'

const SCOPE_LABEL: Record<ChangeScope, string> = {
  agent: 'Last Agent Turn',
  uncommitted: 'Uncommitted',
  staged: 'Staged',
  unstaged: 'Unstaged',
  commits: 'Commits'
}

function sideDelta(
  file: GitChangedFile,
  scope: ChangeScope
): { added: number; removed: number } {
  if (scope === 'staged') {
    return { added: file.addedStaged, removed: file.removedStaged }
  }
  if (scope === 'unstaged') {
    return { added: file.addedUnstaged, removed: file.removedUnstaged }
  }
  return { added: file.added, removed: file.removed }
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

function ScopeDelta({ added, removed }: { added: number; removed: number }) {
  if (added <= 0 && removed <= 0) return null
  return (
    <span className="ml-1 tabular-nums">
      {added > 0 ? <span className="text-success">+{added}</span> : null}
      {removed > 0 ? (
        <span className={cn(added > 0 && 'ml-1', 'text-danger')}>-{removed}</span>
      ) : null}
    </span>
  )
}

const SCOPE_ICON: Record<ChangeScope, IconName> = {
  agent: 'bot',
  uncommitted: 'doc',
  staged: 'plus',
  unstaged: 'circle',
  commits: 'branch'
}

function GitFileRow({
  workspacePath,
  file,
  displayAdded,
  displayRemoved,
  staged,
  ignoreWhitespace,
  sha,
  layout,
  wordWrap,
  findQuery,
  expanded,
  onToggle
}: {
  workspacePath: string
  file: GitChangedFile
  displayAdded: number
  displayRemoved: number
  staged: boolean
  ignoreWhitespace: boolean
  sha?: string | null
  layout: DiffLayout
  wordWrap: boolean
  findQuery: string
  expanded: boolean
  onToggle: () => void
}) {
  const [lines, setLines] = useState<DiffLine[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setLoading(true)
    setDiffError(null)
    void window.vyotiq
      .gitDiff({
        workspacePath,
        path: file.path,
        staged: sha ? undefined : staged,
        ignoreWhitespace,
        sha: sha ?? undefined
      })
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setLines([])
          setDiffError(res.error)
          return
        }
        setDiffError(null)
        setLines(parseUnifiedDiff(res.data.content))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, workspacePath, file.path, staged, ignoreWhitespace, sha])

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
          {basename(file.path)}
        </span>
        <span className="shrink-0 tabular-nums">
          {displayAdded > 0 ? <span className="text-success">+{displayAdded}</span> : null}
          {displayRemoved > 0 ? (
            <span className="ml-1 text-danger">-{displayRemoved}</span>
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
        <div className="border-t border-border/40 bg-surface-2/30 px-2 py-1">
          {loading ? (
            <p className="m-0 px-1 py-1 text-[11px] text-muted">Loading diff…</p>
          ) : lines && lines.length > 0 ? (
            <DiffPreview
              lines={lines}
              path={file.path}
              expanded
              layout={layout}
              findQuery={findQuery}
              wordWrap={wordWrap}
            />
          ) : (
            <p className="m-0 px-1 py-1 text-[11px] text-muted">
              {diffError
                ? diffError
                : file.binary
                  ? 'Binary file'
                  : 'No textual diff'}
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
  onGitMutated,
  onViewPr,
  writeFileResolutions,
  resolvablePaths,
  canResolve,
  resolveBusy,
  resolveBlockedReason,
  onKeepWriteFile,
  onDiscardWriteFile,
  onKeepAllWrites,
  onDiscardAllWrites,
  active = true
}: {
  items: UiItem[]
  className?: string
  workspacePath?: string | null
  gitRevision?: number
  /** Notify parent (composer git chrome) after commits / refreshes from this panel. */
  onGitMutated?: () => void
  onViewPr?: () => void
  writeFileResolutions?: ReadonlyMap<string, 'kept' | 'discarded' | undefined>
  resolvablePaths?: ReadonlySet<string>
  canResolve?: boolean
  resolveBusy?: boolean
  resolveBlockedReason?: string | null
  onKeepWriteFile?: (path: string) => void | Promise<unknown>
  onDiscardWriteFile?: (path: string) => void | Promise<unknown>
  onKeepAllWrites?: () => void | Promise<unknown>
  onDiscardAllWrites?: () => void | Promise<unknown>
  /** When false (hidden mounted dock), do not intercept Ctrl/Cmd+F/R. */
  active?: boolean
}) {
  const chrome = useGitChrome(workspacePath ?? null, gitRevision, Boolean(workspacePath))
  const agentFiles = useMemo(() => collectSessionChangedFiles(items), [items])
  const agentDiffs = useMemo(() => collectSessionFileDiffs(items), [items])

  const [scope, setScope] = useState<ChangeScope>('uncommitted')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [layout, setLayout] = useState<DiffLayout>('unified')
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const [wordWrap, setWordWrap] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [composing, setComposing] = useState(false)
  const [message, setMessage] = useState('')
  const [pushOpen, setPushOpen] = useState(false)
  const [commits, setCommits] = useState<GitLogEntry[]>([])
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitChangedFile[]>([])
  const [commitsBusy, setCommitsBusy] = useState(false)
  const toolbarMenusRef = useRef<HTMLDivElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const commitsSeqRef = useRef(0)

  const closeMenus = useCallback(() => {
    setScopeOpen(false)
    setMenuOpen(false)
    setLayoutOpen(false)
    setPushOpen(false)
  }, [])

  useEffect(() => {
    setScope('uncommitted')
    setSelectedCommit(null)
    setCommitFiles([])
    setCommits([])
    setExpanded(new Set())
    setComposing(false)
    setMessage('')
    setFindOpen(false)
    setFindQuery('')
    closeMenus()
  }, [workspacePath, closeMenus])

  useEffect(() => {
    if (!scopeOpen && !menuOpen && !pushOpen) return undefined
    const onPointerDown = (e: PointerEvent): void => {
      if (toolbarMenusRef.current && !toolbarMenusRef.current.contains(e.target as Node)) {
        closeMenus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [scopeOpen, menuOpen, pushOpen, closeMenus])

  const refreshCommits = useCallback(async () => {
    const seq = ++commitsSeqRef.current
    if (!workspacePath || !window.vyotiq?.gitLog) {
      if (seq === commitsSeqRef.current) setCommits([])
      return
    }
    setCommitsBusy(true)
    try {
      const res = await window.vyotiq.gitLog({ workspacePath, limit: 40 })
      if (seq !== commitsSeqRef.current) return
      if (!res.ok) {
        setCommits([])
        return
      }
      setCommits(res.data)
    } finally {
      if (seq === commitsSeqRef.current) setCommitsBusy(false)
    }
  }, [workspacePath])

  useEffect(() => {
    void refreshCommits()
  }, [refreshCommits, gitRevision])

  useEffect(() => {
    if (scope !== 'commits' || !selectedCommit || !workspacePath) {
      setCommitFiles([])
      return
    }
    let cancelled = false
    void window.vyotiq?.gitCommitFiles?.({ workspacePath, sha: selectedCommit.sha }).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setCommitFiles([])
        return
      }
      setCommitFiles(res.data.files)
    })
    return () => {
      cancelled = true
    }
  }, [scope, selectedCommit, workspacePath])

  useEffect(() => {
    if (!findOpen) return
    findInputRef.current?.focus()
    findInputRef.current?.select()
  }, [findOpen])

  useEffect(() => {
    if (!active) return undefined
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setFindOpen(true)
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        chrome.refresh()
        void refreshCommits()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, chrome, refreshCommits])

  const status: GitStatus | null = chrome.status
  const gitFiles = useMemo(() => status?.files ?? [], [status?.files])

  const scopeTotals = useMemo(() => {
    const sumSide = (files: GitChangedFile[], side: 'all' | 'staged' | 'unstaged') => {
      let added = 0
      let removed = 0
      for (const f of files) {
        if (side === 'staged') {
          added += f.addedStaged
          removed += f.removedStaged
        } else if (side === 'unstaged') {
          added += f.addedUnstaged
          removed += f.removedUnstaged
        } else {
          added += f.added
          removed += f.removed
        }
      }
      return { added, removed }
    }
    return {
      agent: {
        added: agentFiles.reduce((s, f) => s + f.added, 0),
        removed: agentFiles.reduce((s, f) => s + f.removed, 0)
      },
      uncommitted: sumSide(gitFiles, 'all'),
      staged: sumSide(gitFiles.filter((f) => f.staged), 'staged'),
      unstaged: sumSide(gitFiles.filter((f) => f.unstaged), 'unstaged'),
      commits: { added: 0, removed: 0 }
    }
  }, [agentFiles, gitFiles])

  const visibleGitFiles = useMemo(() => {
    switch (scope) {
      case 'agent':
        return []
      case 'commits':
        return commitFiles
      case 'staged':
        return gitFiles.filter((f) => f.staged)
      case 'unstaged':
        return gitFiles.filter((f) => f.unstaged)
      case 'uncommitted':
        return gitFiles
      default: {
        const _exhaustive: never = scope
        return _exhaustive
      }
    }
  }, [gitFiles, scope, commitFiles])

  const filteredFiles = useMemo(() => {
    const q = findQuery.trim().toLowerCase()
    if (!q) return visibleGitFiles
    return visibleGitFiles.filter((f) => f.path.toLowerCase().includes(q))
  }, [visibleGitFiles, findQuery])

  const totals = useMemo(() => {
    if (scope === 'agent') {
      return {
        files: agentFiles.length,
        added: agentFiles.reduce((s, f) => s + f.added, 0),
        removed: agentFiles.reduce((s, f) => s + f.removed, 0)
      }
    }
    if (scope === 'staged' || scope === 'unstaged' || scope === 'uncommitted') {
      let added = 0
      let removed = 0
      for (const f of filteredFiles) {
        const d = sideDelta(f, scope)
        added += d.added
        removed += d.removed
      }
      return { files: filteredFiles.length, added, removed }
    }
    return {
      files: filteredFiles.length,
      added: filteredFiles.reduce((s, f) => s + f.added, 0),
      removed: filteredFiles.reduce((s, f) => s + f.removed, 0)
    }
  }, [scope, agentFiles, filteredFiles])

  const togglePath = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const commitMode: 'all' | 'staged' = scope === 'staged' ? 'staged' : 'all'

  const sendCommit = useCallback(
    (push: boolean) => {
      void chrome.commit(message, push, commitMode).then((ok) => {
        if (!ok) return
        setMessage('')
        setComposing(false)
        setPushOpen(false)
        onGitMutated?.()
        void refreshCommits()
      })
    },
    [chrome, message, commitMode, onGitMutated, refreshCommits]
  )

  const sendStageAll = useCallback(() => {
    void chrome.stageAll().then((ok) => {
      if (!ok) return
      onGitMutated?.()
    })
  }, [chrome, onGitMutated])

  const empty =
    scope === 'agent'
      ? agentFiles.length === 0
      : scope === 'commits' && !selectedCommit
        ? commits.length === 0 && !commitsBusy
        : filteredFiles.length === 0 && !chrome.busy

  const commitPrimaryPushes = Boolean(status?.hasRemote)
  const commitSha = scope === 'commits' ? selectedCommit?.sha ?? null : null

  const fileDiffStaged = (file: GitChangedFile): boolean => {
    if (scope === 'staged') return true
    if (scope === 'unstaged') return false
    if (scope === 'uncommitted') return file.unstaged ? false : Boolean(file.staged)
    return false
  }

  return (
    <div
      className={cn(CHAT_RIGHT_PANEL_BODY, className)}
      data-changes-panel
      role="region"
      aria-label="Changes"
    >
      <div
        ref={toolbarMenusRef}
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-2 py-1.5"
      >
        <div className="relative">
          <button
            type="button"
            className="inline-flex max-w-[10rem] items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-fg hover:bg-surface-2"
            onClick={() => {
              const next = !scopeOpen
              closeMenus()
              setScopeOpen(next)
            }}
            aria-expanded={scopeOpen}
          >
            <Icon name="branch" size={12} className="shrink-0 text-muted" />
            <span className="truncate">
              {scope === 'commits' && selectedCommit
                ? selectedCommit.shortSha
                : scope === 'commits'
                  ? 'All Commits'
                  : SCOPE_LABEL[scope]}
            </span>
            <Icon name="chevron" size={10} className="shrink-0 text-muted" />
          </button>
          {scopeOpen ? (
            <div className="absolute left-0 top-full z-dropdown mt-0.5 min-w-[13rem] rounded-md border border-border bg-bg py-1 shadow-lg">
              {(Object.keys(SCOPE_LABEL) as ChangeScope[]).map((key) => {
                const totalsForScope = scopeTotals[key]
                return (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-surface',
                      scope === key ? 'text-fg' : 'text-muted'
                    )}
                    onClick={() => {
                      setScope(key)
                      if (key !== 'commits') setSelectedCommit(null)
                      setExpanded(new Set())
                      closeMenus()
                    }}
                  >
                    <Icon name={SCOPE_ICON[key]} size={12} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">
                      {SCOPE_LABEL[key]}
                      <ScopeDelta
                        added={totalsForScope.added}
                        removed={totalsForScope.removed}
                      />
                    </span>
                    {scope === key ? <Icon name="check" size={12} className="shrink-0" /> : null}
                    {key === 'commits' ? (
                      <Icon name="chevronRight" size={10} className="shrink-0 text-muted" />
                    ) : null}
                  </button>
                )
              })}
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
              onClick={() => {
                const next = !menuOpen
                closeMenus()
                setMenuOpen(next)
              }}
            >
              ···
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-dropdown mt-0.5 min-w-[14rem] rounded-md border border-border bg-bg py-1 shadow-lg">
                <div className="relative">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                    onClick={() => setLayoutOpen((v) => !v)}
                    aria-expanded={layoutOpen}
                  >
                    <span>
                      Layout{' '}
                      <span className="text-muted">
                        {layout === 'unified' ? 'Unified' : 'Split'}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={10} className="text-muted" />
                  </button>
                  {layoutOpen ? (
                    <div className="absolute left-full top-0 z-dropdown ml-0.5 min-w-[7rem] rounded-md border border-border bg-bg py-1 shadow-lg">
                      {(['unified', 'split'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={cn(
                            'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] capitalize hover:bg-surface',
                            layout === mode ? 'text-fg' : 'text-muted'
                          )}
                          onClick={() => {
                            setLayout(mode)
                            setLayoutOpen(false)
                            closeMenus()
                          }}
                        >
                          {mode}
                          {layout === mode ? <Icon name="check" size={12} className="ml-auto" /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <label className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-fg">
                  Ignore Whitespace
                  <Switch
                    checked={ignoreWhitespace}
                    onCheckedChange={setIgnoreWhitespace}
                    label="Ignore Whitespace"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] text-fg">
                  Word Wrap
                  <Switch
                    checked={wordWrap}
                    onCheckedChange={setWordWrap}
                    label="Word Wrap"
                  />
                </label>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                  onClick={() => {
                    setFindOpen(true)
                    closeMenus()
                  }}
                >
                  Find in Changes
                  <span className="text-[10px] text-muted">Ctrl+F</span>
                </button>
                <button
                  type="button"
                  className="flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                  onClick={() => {
                    setExpanded(new Set())
                    closeMenus()
                  }}
                >
                  Collapse All
                </button>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                  onClick={() => {
                    chrome.refresh()
                    void refreshCommits()
                    closeMenus()
                  }}
                >
                  Refresh Changes
                  <span className="text-[10px] text-muted">Ctrl+R</span>
                </button>
              </div>
            ) : null}
          </div>

          {onViewPr ? (
            <Button
              variant="subtle"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={onViewPr}
            >
              <Icon name="pullRequest" size={12} />
              View PR
            </Button>
          ) : null}

          {scope === 'unstaged' && status && filteredFiles.length > 0 ? (
            <Button
              variant="subtle"
              className="h-6 px-2 text-[11px]"
              disabled={chrome.busy}
              onClick={sendStageAll}
            >
              Stage All
            </Button>
          ) : null}

          {(scope === 'uncommitted' || scope === 'staged') &&
          status &&
          filteredFiles.length > 0 ? (
            <div className="relative flex items-center">
              {composing ? (
                <CommitComposer
                  compact
                  className="mr-1"
                  inputClassName="mr-1 w-36 rounded-md border border-border bg-bg px-1.5 py-0.5 text-[11px] text-fg outline-none"
                  message={message}
                  onMessageChange={setMessage}
                  busy={chrome.busy}
                  hasRemote={Boolean(status.hasRemote)}
                  primaryPushes={commitPrimaryPushes}
                  onCommit={sendCommit}
                  onCancel={() => setComposing(false)}
                />
              ) : (
                <Button
                  variant="subtle"
                  className="h-6 px-2 text-[11px]"
                  disabled={chrome.busy}
                  onClick={() => {
                    setMessage(defaultCommitMessage(filteredFiles, filteredFiles.length))
                    setComposing(true)
                  }}
                >
                  {commitPrimaryPushes ? 'Commit & Push…' : 'Commit…'}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {findOpen ? (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/40 px-2 py-1">
          <Icon name="search" size={12} className="shrink-0 text-muted" />
          <input
            ref={findInputRef}
            type="search"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            placeholder="Find in changes"
            aria-label="Find in changes"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-fg outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFindOpen(false)
                setFindQuery('')
              }
            }}
          />
          <button
            type="button"
            className="rounded px-1 text-[10px] text-muted hover:text-fg"
            aria-label="Close find"
            onClick={() => {
              setFindOpen(false)
              setFindQuery('')
            }}
          >
            Esc
          </button>
        </div>
      ) : null}

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

      {status?.truncated && scope !== 'agent' && scope !== 'commits' ? (
        <p className="m-0 shrink-0 border-b border-border/40 px-3 py-1 text-[11px] text-muted">
          Showing first {status.files.length} of {status.fileCount} changed files
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
                : scope === 'commits'
                  ? 'No commits found in this repository.'
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
            resolveBlockedReason={resolveBlockedReason}
            onKeepFile={onKeepWriteFile}
            onDiscardFile={onDiscardWriteFile}
            onKeepAll={onKeepAllWrites}
            onDiscardAll={onDiscardAllWrites}
          />
        ) : scope === 'commits' && !selectedCommit ? (
          <ul className="m-0 list-none overflow-hidden rounded-md border border-border/50 bg-surface p-0">
            <li className="border-b border-border/40 px-3 py-1.5 text-[11px] text-fg">
              {commits.length} {commits.length === 1 ? 'Commit' : 'Commits'}
            </li>
            {commits.map((c) => (
              <li key={c.sha} className="border-b border-border/40 last:border-b-0">
                <button
                  type="button"
                  className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-1.5 text-left text-[11px] hover:bg-surface/60"
                  onClick={() => {
                    setSelectedCommit(c)
                    setExpanded(new Set())
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-mono text-muted">{c.shortSha}</span>
                    <span className="min-w-0 truncate text-fg">{c.subject}</span>
                  </span>
                  <span className="text-[10px] text-muted">
                    {c.author} · {c.relativeDate}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="m-0 list-none overflow-hidden rounded-md border border-border/50 bg-surface p-0">
            {scope === 'commits' && selectedCommit ? (
              <li className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px]">
                <button
                  type="button"
                  className="shrink-0 text-muted hover:text-fg"
                  onClick={() => {
                    setSelectedCommit(null)
                    setExpanded(new Set())
                  }}
                >
                  ← Commits
                </button>
                <span className="min-w-0 truncate font-mono text-muted">
                  {selectedCommit.shortSha}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg">{selectedCommit.subject}</span>
              </li>
            ) : null}
            <li className="border-b border-border/40 px-3 py-1.5 text-[11px] text-fg">
              {totals.files} {totals.files === 1 ? 'File Changed' : 'Files Changed'}
              {totals.added > 0 ? (
                <span className="ml-2 text-success">+{totals.added}</span>
              ) : null}
              {totals.removed > 0 ? (
                <span className="ml-1 text-danger">-{totals.removed}</span>
              ) : null}
            </li>
            {filteredFiles.map((file) => {
              const delta = sideDelta(file, scope === 'commits' ? 'uncommitted' : scope)
              return (
              <GitFileRow
                key={file.path}
                workspacePath={workspacePath}
                file={file}
                displayAdded={delta.added}
                displayRemoved={delta.removed}
                staged={fileDiffStaged(file)}
                ignoreWhitespace={ignoreWhitespace}
                sha={commitSha}
                layout={layout}
                wordWrap={wordWrap}
                findQuery={findQuery}
                expanded={expanded.has(file.path)}
                onToggle={() => togglePath(file.path)}
              />
              )
            })}
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
              resolveBlockedReason={resolveBlockedReason}
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
