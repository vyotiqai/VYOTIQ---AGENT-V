import { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/ui/cn'

/** Matches the stub created when Plan mode starts a run (`loop.ts`). */
export const PLAN_STUB = [
  '# Plan',
  '',
  '_Draft the plan here. Update as you learn. Do not edit product source in Plan mode._',
  ''
].join('\n')

export function isPlanDraftReady(content: string | null | undefined): boolean {
  if (!content) return false
  const trimmed = content.trim()
  if (!trimmed) return false
  return trimmed !== PLAN_STUB.trim()
}

export function PlanHandoff({
  workspacePath,
  runId,
  agentMode,
  running,
  onContinueInAgent,
  className
}: {
  workspacePath: string | null | undefined
  runId: string | null | undefined
  agentMode: 'ask' | 'plan' | 'agent'
  running?: boolean
  onContinueInAgent: () => void
  className?: string
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (agentMode !== 'plan' || running || !workspacePath || !runId) {
      setContent(null)
      return
    }
    let cancelled = false
    setLoading(true)
    void window.vyotiq
      .readRunArtifact({ workspacePath, runId, name: 'plan.md' })
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data.exists) setContent(res.data.content)
        else setContent(null)
      })
      .catch(() => {
        if (!cancelled) setContent(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentMode, running, workspacePath, runId])

  if (agentMode !== 'plan' || running || loading || !isPlanDraftReady(content)) return null

  const preview = (content ?? '')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('# Plan'))
    .slice(0, 3)
    .join(' · ')
    .slice(0, 160)

  return (
    <div
      className={cn(
        'flex items-start justify-end gap-2 px-2.5 text-right text-[11px] leading-snug tracking-[var(--vy-tracking)] text-secondary',
        className
      )}
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 font-medium text-fg">Plan ready</p>
        {preview ? (
          <p className="m-0 mt-0.5 truncate text-muted" title={preview}>
            {preview}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onContinueInAgent}
        className="shrink-0 rounded-xl border border-border px-1.5 py-0.5 font-medium text-fg transition-colors hover:bg-surface"
      >
        Continue in Agent
      </button>
    </div>
  )
}
