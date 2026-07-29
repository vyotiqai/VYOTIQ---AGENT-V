import { useCallback, useEffect, useState } from 'react'
import { cn } from '@renderer/lib/ui'
import { MarkdownContent } from '@renderer/lib/ui/MarkdownContent'
import { useRunSession } from '../RunSessionContext'
import { EmptyPanel, PanelHeader } from './PanelChrome'
import { isPlanDraftReady } from './composer/PlanHandoff'

type ArtifactTab = 'plan' | 'contract'

/**
 * Docked panel for run plan.md / contract.md artifacts.
 */
export function PlanPanel({
  className,
  onClose
}: {
  className?: string
  onClose?: () => void
}) {
  const { workspacePath, runId } = useRunSession()
  const [tab, setTab] = useState<ArtifactTab>('plan')
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspacePath || !runId) {
      setContent(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const name = tab === 'plan' ? 'plan.md' : 'contract.md'
      const res = await window.vyotiq.readRunArtifact({ workspacePath, runId, name })
      if (!res.ok) {
        setContent(null)
        setError(res.error)
        return
      }
      if (!res.data.exists) {
        setContent(null)
        setError(null)
        return
      }
      setContent(res.data.content)
    } catch (err) {
      setContent(null)
      setError(err instanceof Error ? err.message : 'Failed to load artifact')
    } finally {
      setLoading(false)
    }
  }, [workspacePath, runId, tab])

  useEffect(() => {
    void load()
  }, [load])

  const emptyTitle =
    tab === 'plan'
      ? !content || !isPlanDraftReady(content)
        ? 'No plan drafted yet'
        : 'Plan'
      : 'No contract yet'
  const emptyBody =
    tab === 'plan'
      ? 'Switch to Plan mode and draft plan.md, or continue from an existing plan.'
      : 'The run contract is created when a chat starts.'

  const showEmpty =
    !loading &&
    !error &&
    (!content || (tab === 'plan' && !isPlanDraftReady(content)))

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-[min(42vw,480px)] shrink-0 flex-col overflow-hidden border-l border-border/50 bg-bg',
        className
      )}
      data-plan-panel
      aria-label="Plan panel"
    >
      <PanelHeader title="Plan" onClose={onClose} />
      <div className="flex shrink-0 gap-1 border-b border-border/40 px-2 py-1.5">
        {(
          [
            { id: 'plan', label: 'plan.md' },
            { id: 'contract', label: 'contract.md' }
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              'rounded px-2 py-1 text-xs',
              tab === item.id ? 'bg-surface text-fg' : 'text-muted hover:text-fg'
            )}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading ? (
          <p className="m-0 text-xs text-muted">Loading…</p>
        ) : error ? (
          <p className="m-0 text-xs text-danger">{error}</p>
        ) : showEmpty ? (
          <EmptyPanel icon="file" title={emptyTitle} body={emptyBody} />
        ) : (
          <MarkdownContent content={content ?? ''} className="text-sm" />
        )}
      </div>
    </aside>
  )
}
