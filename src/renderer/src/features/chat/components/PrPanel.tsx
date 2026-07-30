import { useCallback, useEffect, useState } from 'react'
import { Button, cn } from '@renderer/lib/ui'
import { Icon } from '@renderer/lib/icons'
import { MarkdownContent } from '@renderer/lib/ui/MarkdownContent'
import { CHAT_RIGHT_PANEL_BODY } from '@renderer/lib/utils/layout'
import type { PrMergeMethod, PrView } from '@shared/ipc'
import { EmptyPanel } from './PanelChrome'

type PrTab = 'changes' | 'description' | 'commits' | 'checks'

/**
 * Docked PR panel backed by GitHub CLI (`gh`).
 */
export function PrPanel({
  workspacePath,
  className,
  onPrMeta
}: {
  workspacePath?: string | null
  className?: string
  onPrMeta?: (meta: { number: number; title: string } | null) => void
}) {
  const [pr, setPr] = useState<PrView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<PrTab>('changes')
  const [menuOpen, setMenuOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeBusy, setMergeBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeFailed, setNoticeFailed] = useState(false)

  const load = useCallback(async () => {
    if (!workspacePath || !window.vyotiq?.prView) {
      setPr(null)
      onPrMeta?.(null)
      setError(
        !window.vyotiq?.prView
          ? 'PR IPC unavailable'
          : 'Open a workspace to view a pull request.'
      )
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await window.vyotiq.prView(workspacePath)
      if (!res.ok) {
        setPr(null)
        onPrMeta?.(null)
        setError(res.error)
        return
      }
      setPr(res.data)
      onPrMeta?.(
        res.data ? { number: res.data.number, title: res.data.title } : null
      )
      if (!res.data) {
        setError(
          'No pull request for this branch. Install GitHub CLI and run `gh auth login`, then open or create a PR.'
        )
      }
    } finally {
      setLoading(false)
    }
  }, [workspacePath, onPrMeta])

  useEffect(() => {
    void load()
  }, [load])

  const merge = useCallback(
    async (method: PrMergeMethod) => {
      if (!workspacePath || !window.vyotiq?.prMerge) return
      setMergeBusy(true)
      setNotice(null)
      setNoticeFailed(false)
      setMergeOpen(false)
      try {
        const res = await window.vyotiq.prMerge(workspacePath, method)
        if (res.ok) {
          setNotice(res.data.detail)
          setNoticeFailed(false)
          void load()
        } else {
          setNotice(res.error)
          setNoticeFailed(true)
        }
      } finally {
        setMergeBusy(false)
      }
    },
    [workspacePath, load]
  )

  return (
    <div
      className={cn(CHAT_RIGHT_PANEL_BODY, className)}
      data-pr-panel
      role="region"
      aria-label="Pull request panel"
    >
      {pr ? (
        <div className="flex shrink-0 flex-col gap-1 border-b border-border/40 px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-medium text-success">
              {pr.state}
            </span>
            <span className="min-w-0 truncate text-[11px] text-muted">
              {pr.headRefName} → {pr.baseRefName}
            </span>
            <div className="relative ml-auto flex items-center gap-1">
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2"
                aria-label="PR actions"
                onClick={() => setMenuOpen((v) => !v)}
              >
                ···
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-full z-dropdown mt-0.5 min-w-[11rem] rounded-md border border-border bg-bg py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                    onClick={() => {
                      setMenuOpen(false)
                      void load()
                    }}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                    onClick={() => {
                      setMenuOpen(false)
                      void navigator.clipboard.writeText(pr.url)
                    }}
                  >
                    Copy URL
                  </button>
                  <button
                    type="button"
                    className="flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                    onClick={() => {
                      setMenuOpen(false)
                      window.open(pr.url, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    Open in browser
                  </button>
                </div>
              ) : null}
              <div className="relative flex">
                <Button
                  variant="subtle"
                  className="h-6 rounded-r-none px-2 text-[11px] text-success"
                  disabled={mergeBusy}
                  onClick={() => void merge('squash')}
                >
                  Squash &amp; Merge
                </Button>
                <button
                  type="button"
                  className="inline-flex h-6 items-center rounded-r-md border border-l-0 border-border bg-surface px-1 text-muted hover:bg-surface-2"
                  aria-label="Merge method"
                  onClick={() => setMergeOpen((v) => !v)}
                >
                  <Icon name="chevron" size={10} />
                </button>
                {mergeOpen ? (
                  <div className="absolute right-0 top-full z-dropdown mt-0.5 min-w-[10rem] rounded-md border border-border bg-bg py-1 shadow-lg">
                    {(
                      [
                        ['squash', 'Squash & Merge'],
                        ['merge', 'Merge'],
                        ['rebase', 'Rebase Merge']
                      ] as const
                    ).map(([method, label]) => (
                      <button
                        key={method}
                        type="button"
                        className="flex w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-surface"
                        disabled={mergeBusy}
                        onClick={() => void merge(method)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <p className="m-0 truncate text-[12px] font-medium text-fg" title={pr.title}>
            {pr.title} #{pr.number}
          </p>
          <div className="flex gap-1 overflow-x-auto">
            {(
              [
                ['changes', `Changes ${pr.files.length}`],
                ['description', 'Description'],
                ['commits', `Commits ${pr.commits.length}`],
                ['checks', `Checks ${pr.checks.length}`]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn(
                  'shrink-0 rounded px-2 py-1 text-[11px]',
                  tab === id ? 'bg-bg text-fg underline decoration-accent' : 'text-muted hover:text-fg'
                )}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {notice ? (
        <p
          className={cn(
            'm-0 shrink-0 border-b border-border/40 px-3 py-1 text-[11px]',
            noticeFailed ? 'text-danger' : 'text-success'
          )}
          role={noticeFailed ? 'alert' : 'status'}
        >
          {notice}
        </p>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3">
        {loading ? (
          <p className="m-0 text-xs text-muted">Loading…</p>
        ) : !pr ? (
          <EmptyPanel
            icon="pullRequest"
            title="No pull request"
            body={error ?? 'Connect GitHub CLI (`gh auth login`) to view PRs for this branch.'}
          />
        ) : tab === 'description' ? (
          <MarkdownContent content={pr.body || '_No description_'} className="text-sm" />
        ) : tab === 'commits' ? (
          pr.commits.length === 0 ? (
            <p className="m-0 text-[11px] text-muted">No commits reported for this pull request.</p>
          ) : (
          <ul className="m-0 list-none space-y-1.5 p-0">
            {pr.commits.map((c) => (
              <li key={c.oid} className="rounded-md border border-border/40 px-2.5 py-1.5 text-[11px]">
                <p className="m-0 text-fg">{c.messageHeadline}</p>
                <p className="m-0 mt-0.5 truncate text-muted">
                  {c.oid.slice(0, 7)}
                  {c.authors.length ? ` · ${c.authors.join(', ')}` : ''}
                </p>
              </li>
            ))}
          </ul>
          )
        ) : tab === 'checks' ? (
          <ul className="m-0 list-none space-y-1 p-0">
            {pr.checks.length === 0 ? (
              <li className="text-[11px] text-muted">No checks reported.</li>
            ) : (
              pr.checks.map((c, i) => (
                <li
                  key={`${c.name}-${i}`}
                  className="flex items-center gap-2 rounded-md border border-border/40 px-2.5 py-1.5 text-[11px]"
                >
                  <span className="min-w-0 flex-1 truncate text-fg">{c.name}</span>
                  <span className="shrink-0 text-muted">
                    {c.conclusion ?? c.state}
                  </span>
                </li>
              ))
            )}
          </ul>
        ) : (
          <>
            <p className="m-0 mb-2 text-[11px] text-muted">
              {pr.files.length} Files Changed{' '}
              <span className="text-success">+{pr.additions}</span>{' '}
              <span className="text-danger">-{pr.deletions}</span>
            </p>
            <ul className="m-0 list-none space-y-0.5 p-0">
              {pr.files.map((f) => (
                <li
                  key={f.path}
                  className="flex items-center gap-2 rounded px-2 py-1 text-[11px] hover:bg-surface"
                >
                  <span className="min-w-0 flex-1 truncate text-fg" title={f.path}>
                    {f.path}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {f.additions > 0 ? (
                      <span className="text-success">+{f.additions}</span>
                    ) : null}
                    {f.deletions > 0 ? (
                      <span className="ml-1 text-danger">-{f.deletions}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
