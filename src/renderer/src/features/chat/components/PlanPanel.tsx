import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/ui'
import { MarkdownContent } from '@renderer/lib/ui/MarkdownContent'
import { CHAT_RIGHT_PANEL_BODY } from '@renderer/lib/utils/layout'
import type { RunReceipt } from '@shared/ipc'
import { RunReceiptSchema } from '@shared/ipc'
import { EmptyPanel } from './PanelChrome'
import { isPlanDraftReady } from './composer/PlanHandoff'

type ArtifactTab = 'plan' | 'contract' | 'receipt'

const POLL_MS_WHILE_RUNNING = 2000

const TAB_TITLE: Record<ArtifactTab, string> = {
  plan: 'Plan',
  contract: 'Contract',
  receipt: 'Receipt'
}

function parsePlanOutline(markdown: string): {
  headings: string[]
  checked: number
  unchecked: number
} {
  const headings: string[] = []
  let checked = 0
  let unchecked = 0
  for (const line of markdown.split(/\r?\n/)) {
    const h = line.match(/^#{2,3}\s+(.+)$/)
    if (h?.[1]) headings.push(h[1].trim())
    if (/^\s*[-*]\s+\[[xX]\]\s+/.test(line)) checked += 1
    else if (/^\s*[-*]\s+\[\s\]\s+/.test(line)) unchecked += 1
  }
  return { headings, checked, unchecked }
}

function openWorkspacePath(workspacePath: string, path: string): void {
  void window.vyotiq.slashCommandsOpenFile({ workspacePath, path })
}

function ReceiptSummary({
  receipt,
  workspacePath
}: {
  receipt: RunReceipt
  workspacePath: string | null
}) {
  const failTop = receipt.failureClusters.slice(0, 5)
  const subagents = receipt.subagents
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

      <section>
        <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted">
          Contract done-when
        </h3>
        <p className="m-0 mt-1 text-xs">
          mode={receipt.contractDoneWhen.mode} · nudged=
          {receipt.contractDoneWhen.nudged ? 'yes' : 'no'} · checkable=
          {receipt.contractDoneWhen.checkableCriteria}
        </p>
        {receipt.contractDoneWhen.unmetCriteria &&
        receipt.contractDoneWhen.unmetCriteria.length > 0 ? (
          <ul className="mt-1 list-disc pl-4 text-xs text-muted">
            {receipt.contractDoneWhen.unmetCriteria.slice(0, 8).map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {subagents && subagents.length > 0 ? (
        <section>
          <h3 className="m-0 text-xs font-medium uppercase tracking-wide text-muted">
            Subagents
          </h3>
          <ul className="mt-1 list-disc pl-4 text-xs text-muted">
            {subagents.map((s) => (
              <li key={s.id}>
                {s.id} · {s.status}
                {s.reportPath ? (
                  <>
                    {' · '}
                    {workspacePath ? (
                      <button
                        type="button"
                        className="font-mono text-fg/80 underline-offset-2 hover:underline"
                        title={s.reportPath}
                        onClick={() => openWorkspacePath(workspacePath, s.reportPath!)}
                      >
                        {s.reportPath}
                      </button>
                    ) : (
                      <span className="font-mono">{s.reportPath}</span>
                    )}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
  className
}: {
  workspacePath: string | null
  runId: string | null
  running?: boolean
  className?: string
}) {
  const [tab, setTab] = useState<ArtifactTab>('plan')
  const [content, setContent] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<RunReceipt | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wasRunningRef = useRef(running)
  const loadSeqRef = useRef(0)

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const seq = ++loadSeqRef.current
      const requestedTab = tab
      if (!workspacePath || !runId) {
        if (seq !== loadSeqRef.current) return
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
          requestedTab === 'plan'
            ? 'plan.md'
            : requestedTab === 'contract'
              ? 'contract.md'
              : 'receipt.json'
        const res = await window.vyotiq.readRunArtifact({ workspacePath, runId, name })
        if (seq !== loadSeqRef.current) return
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
        if (requestedTab === 'receipt') {
          const rawText = res.data.content ?? ''
          let raw: unknown
          try {
            raw = JSON.parse(rawText) as unknown
          } catch {
            setReceipt(null)
            setContent(null)
            setError('Invalid receipt.json')
            return
          }
          const parsed = RunReceiptSchema.safeParse(raw)
          if (!parsed.success) {
            setReceipt(null)
            setContent(null)
            setError('Invalid receipt.json')
            return
          }
          setReceipt(parsed.data)
          setContent(null)
          setError(null)
        } else {
          setReceipt(null)
          setContent(res.data.content)
          setError(null)
        }
      } catch (err) {
        if (seq !== loadSeqRef.current) return
        setContent(null)
        setReceipt(null)
        setError(err instanceof Error ? err.message : 'Failed to load artifact')
      } finally {
        if (seq === loadSeqRef.current && !opts?.quiet) setLoading(false)
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

  const panelTitle = TAB_TITLE[tab]
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
    <div
      className={cn(CHAT_RIGHT_PANEL_BODY, className)}
      data-plan-panel
      role="region"
      aria-label={`${panelTitle} panel`}
    >
      <div className="flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-border/40 px-2 py-1.5">
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
              'shrink-0 rounded px-2 py-1 text-xs',
              tab === item.id ? 'bg-surface text-fg' : 'text-muted hover:text-fg'
            )}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-3 [overflow-wrap:anywhere]">
        {loading ? (
          <p className="m-0 text-xs text-muted">Loading…</p>
        ) : error ? (
          <p className="m-0 text-xs text-danger">{error}</p>
        ) : showEmpty ? (
          <EmptyPanel icon="file" title={emptyTitle} body={emptyBody} />
        ) : tab === 'receipt' && receipt ? (
          <ReceiptSummary receipt={receipt} workspacePath={workspacePath} />
        ) : tab === 'plan' && content && isPlanDraftReady(content) ? (
          <>
            {(() => {
              const outline = parsePlanOutline(content)
              const total = outline.checked + outline.unchecked
              if (outline.headings.length === 0 && total === 0) return null
              return (
                <div className="mb-3 rounded-md border border-border/40 bg-surface px-2.5 py-2">
                  {total > 0 ? (
                    <p className="m-0 text-[11px] text-muted">
                      Checklist {outline.checked}/{total}
                    </p>
                  ) : null}
                  {outline.headings.length > 0 ? (
                    <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                      {outline.headings.slice(0, 8).map((h, i) => (
                        <li key={`${i}:${h}`} className="truncate text-[11px] text-fg">
                          {h}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })()}
            <MarkdownContent content={content} className="text-sm" />
          </>
        ) : (
          <MarkdownContent content={content ?? ''} className="text-sm" />
        )}
      </div>
    </div>
  )
}
