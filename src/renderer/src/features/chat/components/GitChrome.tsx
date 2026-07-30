import { useCallback, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { FLOATING_CHROME } from '@renderer/lib/utils/layout'
import type { GitStatus } from '@shared/ipc'
import { useGitStatus } from './useGitStatus'
import { CommitComposer } from './CommitComposer'

const PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] vy-transition'

export type GitChrome = {
  status: GitStatus | null
  ready: boolean
  busy: boolean
  notice: string | null
  noticeFailed: boolean
  refresh: () => void
  commit: (message: string, push: boolean) => Promise<boolean>
}

/** Commit messages are the user's to write; this is only a starting point. */
function defaultMessage(status: GitStatus): string {
  const first = status.files[0]
  if (status.fileCount === 1 && first) return `Update ${first.path}`
  return `Update ${status.fileCount} files`
}

/**
 * The workspace's git state plus the one action we offer on it.
 *
 * Held by the chat view rather than by each piece of chrome, because the branch
 * strip and the change pills are far apart on screen but describe the same
 * repository, and asking git twice for that would be wasteful.
 */
export function useGitChrome(
  workspacePath: string | null,
  revision: number,
  enabled = true
): GitChrome {
  const { status, loading, refresh } = useGitStatus(workspacePath, revision, enabled)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeFailed, setNoticeFailed] = useState(false)

  const commit = useCallback(
    async (message: string, push: boolean): Promise<boolean> => {
      if (!workspacePath || !message.trim() || busy) return false
      setBusy(true)
      setNotice(null)
      setNoticeFailed(false)
      try {
        const result = await window.vyotiq.gitCommit(workspacePath, message.trim(), push)
        setNotice(result.ok ? result.data.detail : result.error)
        setNoticeFailed(!result.ok)
        return result.ok
      } finally {
        setBusy(false)
        refresh()
      }
    },
    [workspacePath, busy, refresh]
  )

  return {
    status,
    ready: !loading && Boolean(status),
    busy,
    notice,
    noticeFailed,
    refresh,
    commit
  }
}

/**
 * How much the working tree has moved, and the way to commit it.
 *
 * Sits above the docked composer so the size of a change is visible without
 * scrolling the transcript.
 */
export function GitChangePills({ chrome }: { chrome: GitChrome }) {
  const { status, ready, busy, notice, noticeFailed, commit } = chrome
  const [composing, setComposing] = useState(false)
  const [message, setMessage] = useState('')

  const open = useCallback(() => {
    if (!status) return
    setMessage((current) => current || defaultMessage(status))
    setComposing(true)
  }, [status])

  const send = useCallback(
    (push: boolean) => {
      void commit(message, push).then((ok) => {
        if (!ok) return
        setMessage('')
        setComposing(false)
      })
    },
    [commit, message]
  )

  if (!ready || !status || status.fileCount === 0) return null

  return (
    <div className="pointer-events-auto flex flex-col items-start gap-1.5">
      {composing ? (
        <div className={cn(FLOATING_CHROME, 'w-full p-1.5')}>
          <CommitComposer
            message={message}
            onMessageChange={setMessage}
            busy={busy}
            hasRemote={status.hasRemote}
            primaryPushes={false}
            onCommit={send}
            onCancel={() => setComposing(false)}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 text-tertiary">
        <span className={cn(PILL, 'tabular-nums')}>
          <span>Changes</span>
          {status.added > 0 ? <span className="text-success">+{status.added}</span> : null}
          {status.removed > 0 ? <span className="text-danger">-{status.removed}</span> : null}
        </span>

        <button
          type="button"
          className={cn(PILL, 'text-fg hover:bg-surface-2')}
          onClick={() => (composing ? setComposing(false) : open())}
          aria-expanded={composing}
          aria-label="Write a commit message"
        >
          {status.hasRemote ? 'Commit…' : 'Commit'}
          <Icon
            name="chevronRight"
            size={14}
            className={cn('vy-transition', composing ? 'rotate-90' : '-rotate-90')}
          />
        </button>

        {notice ? (
          <span
            className={cn('px-1 text-[11px]', noticeFailed ? 'text-danger' : 'text-secondary')}
            role={noticeFailed ? 'alert' : 'status'}
          >
            {notice}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** The repository line under the composer: which branch, and a way to re-read it. */
export function GitBranchStrip({ chrome }: { chrome: GitChrome }) {
  const { status, ready, refresh } = chrome
  if (!ready || !status) return null

  return (
    <div className="pointer-events-auto flex items-center gap-2 px-1 text-[11px] text-tertiary">
      <span className="inline-flex items-center gap-1.5">
        <Icon name="branch" size={14} />
        <span className="max-w-[24ch] truncate text-fg">{status.branch ?? 'detached'}</span>
      </span>

      <button
        type="button"
        className="ml-auto inline-grid size-6 place-items-center rounded-sm vy-transition hover:bg-surface hover:text-fg"
        onClick={refresh}
        aria-label="Refresh git status"
      >
        <Icon name="refresh" size={14} />
      </button>
    </div>
  )
}
