import { memo, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { cn } from '@renderer/lib/ui'
import { TOOL_CARD_BODY, TOOL_CARD_HEADER, TOOL_CARD_SURFACE } from '@renderer/lib/utils/layout'
import type { UiToolApproval } from '@shared/transcript'
import type { ToolApprovalDecision } from '@shared/ipc'

const CHOICES: { decision: ToolApprovalDecision; label: string; primary?: boolean }[] = [
  { decision: 'once', label: 'Allow once', primary: true },
  { decision: 'session', label: 'Allow for session' },
  { decision: 'always', label: 'Always allow' }
]

export const ToolApprovalCard = memo(function ToolApprovalCard({
  approval,
  onDecide
}: {
  approval: UiToolApproval
  onDecide?: (requestId: string, decision: ToolApprovalDecision) => void | Promise<void>
}) {
  const [phase, setPhase] = useState<'idle' | 'pending' | 'done'>('idle')
  const [localError, setLocalError] = useState<string | null>(null)

  const decide = (decision: ToolApprovalDecision): void => {
    if (phase !== 'idle') return
    setPhase('pending')
    setLocalError(null)
    void Promise.resolve(onDecide?.(approval.requestId, decision))
      .then(() => {
        // Stay locked; parent usually removes the card on success.
        setPhase('done')
      })
      .catch((err: unknown) => {
        setPhase('idle')
        setLocalError(err instanceof Error ? err.message : 'Could not send decision')
      })
  }

  const busy = phase !== 'idle'
  const sending = phase === 'pending'

  return (
    <div className={cn(TOOL_CARD_SURFACE, 'w-full border-accent/50')} role="group">
      <div className={cn(TOOL_CARD_HEADER, 'flex items-center gap-2 text-fg')}>
        <Icon name="warning" size={12} className="shrink-0 text-danger" />
        <span className="font-medium">
          Allow tool: <span className="font-mono">{approval.toolName}</span>?
        </span>
        <span className="min-w-0 truncate text-tertiary" title={approval.summary}>
          {approval.summary}
        </span>
        <span className="ml-auto shrink-0 text-tertiary">
          {approval.mutating ? 'mutating / network' : 'read-only'}
        </span>
      </div>
      {approval.argsPreview ? (
        <pre className={cn(TOOL_CARD_BODY, 'max-h-40 overflow-auto px-3 py-2 text-xs text-secondary')}>
          {approval.argsPreview}
        </pre>
      ) : null}
      {localError ? (
        <p className="border-t border-border px-3 py-2 text-xs text-danger" role="alert">
          {localError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        {CHOICES.map((choice) => (
          <button
            key={choice.decision}
            type="button"
            disabled={busy}
            className={cn(
              'rounded-md border px-2 py-1 text-xs vy-transition disabled:opacity-[var(--vy-disabled-opacity)]',
              choice.primary
                ? 'border-accent bg-accent text-accent-fg hover:opacity-90'
                : 'border-border text-fg hover:bg-surface'
            )}
            onClick={() => decide(choice.decision)}
          >
            {sending ? 'Sending…' : choice.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-danger vy-transition hover:bg-surface disabled:opacity-[var(--vy-disabled-opacity)]"
          onClick={() => decide('deny')}
        >
          {sending ? 'Sending…' : 'Deny'}
        </button>
      </div>
    </div>
  )
})
