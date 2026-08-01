import { useEffect, useState } from 'react'
import { cn } from '@renderer/lib/ui/cn'

/** Matches the stub created when Plan mode starts a run (`loop.ts`). */
export const PLAN_STUB = [
  '# Plan',
  '',
  '_Draft the plan here. Update as you learn. Do not edit product source in Plan mode._',
  ''
].join('\n')

function isPlanTitle(line: string): boolean {
  return /^#\s*Plan\s*$/i.test(line.trim())
}

// Match the Plan stub hint line, with or without surrounding underscores. The
// hint may end after the first sentence, after the second, or after the third.
const STUB_HINT_RE = /^\s*_{0,2}\s*Draft the plan here(?:\. Update as you learn(?:\. Do not edit product source in Plan mode)?)?\.?\s*_{0,2}\s*$/i
function isStubHint(line: string): boolean {
  return STUB_HINT_RE.test(line)
}

/** Outline headings without drafted body (`## Goal`). */
function isBareHeading(line: string): boolean {
  const trimmed = line.trim()
  const m = trimmed.match(/^#{1,6}\s+(.+)$/)
  if (!m) return false
  const rest = m[1]!.trim()
  if (!rest) return true
  if (/[.!?]/.test(rest)) return false
  return rest.split(/\s+/).length <= 4
}

function stripMarkdownChrome(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*{1,2}|\*{1,2}$/g, '')
    .replace(/^_{1,2}|_{1,2}$/g, '')
    .replace(/^[-*+]\s*\[[ xX]\]\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .trim()
}

/** Substantive plan body lines for readiness + preview. */
export function planDraftBodyLines(content: string): string[] {
  const out: string[] = []
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (isPlanTitle(line)) continue
    if (isStubHint(line)) continue
    if (isBareHeading(line)) continue
    const cleaned = stripMarkdownChrome(line)
    if (!cleaned) continue
    out.push(cleaned)
  }
  return out
}

export function isPlanDraftReady(content: string | null | undefined): boolean {
  if (!content) return false
  const trimmed = content.trim()
  if (!trimmed) return false
  if (trimmed === PLAN_STUB.trim()) return false
  return planDraftBodyLines(trimmed).length > 0
}

export function planHandoffPreview(content: string, maxLen = 120): string {
  const lines = planDraftBodyLines(content).slice(0, 2)
  if (!lines.length) return ''
  const joined = lines.join(' · ')
  if (joined.length <= maxLen) return joined
  return `${joined.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`
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
    const load = (quiet = false): void => {
      if (!quiet) setLoading(true)
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
          if (!cancelled && !quiet) setLoading(false)
        })
    }
    load(false)
    // Keep preview in sync with Plan panel edits after the run finishes.
    const id = window.setInterval(() => load(true), 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [agentMode, running, workspacePath, runId])

  if (agentMode !== 'plan' || running || loading || !isPlanDraftReady(content)) return null

  const preview = planHandoffPreview(content ?? '')

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-2.5 py-1 text-[11px] leading-tight text-secondary',
        className
      )}
      role="status"
    >
      <div className="min-w-0 flex-1 text-left">
        <p className="m-0 font-medium text-fg">Plan ready</p>
        {preview ? (
          <p className="m-0 mt-0.5 truncate text-secondary" title={preview}>
            {preview}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onContinueInAgent}
        className="shrink-0 rounded-xl border border-border px-2 py-1 font-medium text-fg transition-colors hover:bg-surface"
      >
        Continue in Agent
      </button>
    </div>
  )
}
