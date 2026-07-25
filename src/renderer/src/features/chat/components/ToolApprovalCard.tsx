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
  onDecide?: (requestId: string, decision: ToolApprovalDecision) => void
}) {
  const [answered, setAnswered] = useState(false)

  const decide = (decision: ToolApprovalDecision): void => {
    if (answered) return
    setAnswered(true)
    onDecide?.(approval.requestId, decision)
  }

  return (
    <div className={cn(TOOL_CARD_SURFACE, 'w-full border-accent/50')} role="group">
      <div className={cn(TOOL_CARD_HEADER, 'flex items-center gap-2 text-fg')}>
        <Icon name="warning" size={12} className="shrink-0 text-accent" />
        <span className="font-medium">
          Run <span className="font-mono">{approval.toolName}</span>?
        </span>
        <span className="min-w-0 truncate text-tertiary" title={approval.summary}>
          {approval.summary}
        </span>
        <span className="ml-auto shrink-0 text-tertiary">
          {approval.mutating ? 'modifies workspace' : 'read-only'}
        </span>
      </div>
      {approval.argsPreview ? (
        <pre className={cn(TOOL_CARD_BODY, 'max-h-40 overflow-auto px-3 py-2 text-xs text-secondary')}>
          {approval.argsPreview}
        </pre>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        {CHOICES.map((choice) => (
          <button
            key={choice.decision}
            type="button"
            disabled={answered}
            className={cn(
              'rounded-md border px-2 py-1 text-xs vy-transition disabled:opacity-50',
              choice.primary
                ? 'border-accent bg-accent text-accent-fg hover:opacity-90'
                : 'border-border text-fg hover:bg-surface'
            )}
            onClick={() => decide(choice.decision)}
          >
            {choice.label}
          </button>
        ))}
        <button
          type="button"
          disabled={answered}
          className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-danger vy-transition hover:bg-surface disabled:opacity-50"
          onClick={() => decide('deny')}
        >
          Deny
        </button>
      </div>
    </div>
  )
})
