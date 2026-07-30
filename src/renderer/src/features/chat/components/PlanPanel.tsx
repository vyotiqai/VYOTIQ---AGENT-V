import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/ui'
import { MarkdownContent } from '@renderer/lib/ui/MarkdownContent'
import type { RunReceipt } from '@shared/ipc'
import { EmptyPanel, PanelHeader } from './PanelChrome'
import { isPlanDraftReady } from './composer/PlanHandoff'

type ArtifactTab = 'plan' | 'contract' | 'receipt'

const POLL_MS_WHILE_RUNNING = 2000

function ReceiptSummary({ receipt }: { receipt: RunReceipt }) {
  const failTop = receipt.failureClusters.slice(0, 5)
  return (
    <div className="space-y-3 text-sm" data-receipt-summary>
      <section>
        <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted">Status</h3>
        <p className="m-0 mt-1 text-fg">
          {receipt.status}
          {receipt.statusError ? ` — ${receipt.statusError}` : ''}
          {' · '}
          step {receipt.step}
          {receipt.mode ? ` · ${receipt.mode}` : ''}
        </p>
        {receipt.goal ? <p className="m-0 mt-1 text-muted">{receipt.goal}</p> : null}
      </section>

      <section>
        <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted">Tools</h3>
        <p className="m-0 mt-1">
          {receipt.toolStats.totalCalls} calls · {receipt.toolStats.ok} ok ·{' '}
          {receipt.toolStats.failed} failed
        </p>
        {failTop.length > 0 ? (
          <ul className="mt-1 list-disc pl-4 text-xs text-muted">
            {failTop.map((f) => (
              <li key={f.key}>
                {f.count}× {f.key}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted">Verify</h3>
        <p className="m-0 mt-1 text-xs">
          mode={receipt.verifyBeforeDone.mode} · nudged=
          {receipt.verifyBeforeDone.nudged ? 'yes' : 'no'} · diagnostics=
          {receipt.diagnostics.ok}/{receipt.diagnostics.calls}
        </p>
      </section>

      {receipt.unreadEditPaths.length > 0 ? (
        <section>
          <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted">
            Unread edits
          </h3>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {receipt.unreadEditPaths.slice(0, 12).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {receipt.wroteFiles.length > 0 ? (
        <section>
          <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted">Wrote</h3>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {receipt.wroteFiles.slice(0, 12).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {(receipt.tokenUsage || receipt.compactionCount > 0 || receipt.incomplete) && (
        <section>
          <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted">Context</h3>
          <p className="m-0 mt-1 text-xs text-muted">
            {receipt.tokenUsage?.inputTokens != null
              ? `in ${receipt.tokenUsage.inputTokens}`
              : null}
            {receipt.tokenUsage?.outputTokens != null
              ? ` · out ${receipt.tokenUsage.outputTokens}`
              : null}
            {receipt.compactionCount > 0 ? ` · compact×${receipt.compactionCount}` : null}
            {receipt.incomplete
              ? ` · incomplete: ${receipt.incomplete.reason}`
              : null}
          </p>
        </section>
      )}
    </div>
  )
}

/**
 * Docked panel for run plan.md / contract.md / receipt.json artifacts.
 * Identity must be passed as props — this panel sits outside RunSessionProvider.
 */
export function PlanPanel({
  workspacePath,
  runId,
  running = false,
  className,
  onClose
}: {
  workspacePath: string | null
  runId: string | null
  running?: boolean
  className?: string
  onClose?: () => void
}) {
  const [tab, setTab] = useState<ArtifactTab>('plan')
  const [content, setContent] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<RunReceipt | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wasRunningRef = useRef(running)

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!workspacePath || !runId) {
        setContent(null)
        setReceipt(null)
        setError(null)
        return
      }
      if (!opts?.quiet) {
        setLoading(true)
        setError(null)
      }
      try {
        const name =
          tab === 'plan' ? 'plan.md' : tab === 'contract' ? 'contract.md' : 'receipt.json'
        const res = await window.vyotiq.readRunArtifact({ workspacePath, runId, name })
        if (!res.ok) {
          setContent(null)
          setReceipt(null)
          setError(res.error)
          return
        }
        if (!res.data.exists) {
          setContent(null)
          setReceipt(null)
          setError(null)
          return
        }
        if (tab === 'receipt') {
          const raw = res.data.content ?? ''
          try {
            setReceipt(JSON.parse(raw) as RunReceipt)
            setContent(null)
            setError(null)
          } catch {
            setReceipt(null)
            setContent(null)
            setError('Invalid receipt.json')
          }
        } else {
          setReceipt(null)
          setContent(res.data.content)
          setError(null)
        }
      } catch (err) {
        setContent(null)
        setReceipt(null)
        setError(err instanceof Error ? err.message : 'Failed to load artifact')
      } finally {
        if (!opts?.quiet) setLoading(false)
      }
    },
    [workspacePath, runId, tab]
  )

  useEffect(() => {
    void load()
  }, [load])

  // Reload when the agent run finishes so post-write plan/contract/receipt appear.
  useEffect(() => {
    const wasRunning = wasRunningRef.current
    wasRunningRef.current = running
    if (wasRunning && !running) {
      void load({ quiet: true })
    }
  }, [running, load])

  // Light poll while the agent is running so mid-run edits show up.
  useEffect(() => {
    if (!running || !workspacePath || !runId) return
    const id = window.setInterval(() => {
      void load({ quiet: true })
    }, POLL_MS_WHILE_RUNNING)
    return () => window.clearInterval(id)
  }, [running, workspacePath, runId, load])

  const emptyTitle =
    tab === 'plan'
      ? !content || !isPlanDraftReady(content)
        ? 'No plan drafted yet'
        : 'Plan'
      : tab === 'contract'
        ? 'No contract yet'
        : 'No receipt yet'
  const emptyBody =
    tab === 'plan'
      ? 'Switch to Plan mode and draft plan.md, or continue from an existing plan.'
      : tab === 'contract'
        ? 'The run contract is created when a chat starts.'
        : 'receipt.json is written when a run finishes.'

  const showEmpty =
    !loading &&
    !error &&
    (tab === 'receipt'
      ? !receipt
      : !content || (tab === 'plan' && !isPlanDraftReady(content)))

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
            { id: 'contract', label: 'contract.md' },
            { id: 'receipt', label: 'receipt.json' }
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
        ) : tab === 'receipt' && receipt ? (
          <ReceiptSummary receipt={receipt} />
        ) : (
          <MarkdownContent content={content ?? ''} className="text-sm" />
        )}
      </div>
    </aside>
  )
}
