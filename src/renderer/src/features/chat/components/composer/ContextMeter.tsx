import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/ui/cn'
import { useDropdownMenu } from '@renderer/lib/hooks/useDropdownMenu'
import type { ContextUsageState } from '@shared/utils/contextUsage'
import type { StepUsageTotals } from '@shared/utils/runTelemetry'

export type { ContextUsageState }

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function formatPct(n: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((n / total) * 100)}%`
}

function LayerRow({
  label,
  tokens,
  total,
  hint
}: {
  label: string
  tokens: number
  total: number
  hint?: string
}) {
  const ratio = total > 0 ? Math.min(1, tokens / total) : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted">
          {label}
          {hint ? <span className="text-[10px] opacity-70"> {hint}</span> : null}
        </span>
        <span className="tabular-nums text-fg">
          {formatTokens(tokens)}{' '}
          <span className="text-muted">({formatPct(tokens, total)})</span>
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent/70" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}

function StepUsageSection({ totals }: { totals: StepUsageTotals }) {
  if (
    totals.steps <= 0 &&
    totals.outputTokens <= 0 &&
    totals.cachedInputTokens <= 0 &&
    totals.reasoningTokens <= 0
  ) {
    return null
  }
  const cachePct =
    totals.cachedInputTokens > 0 && totals.inputTokens > 0
      ? Math.round((totals.cachedInputTokens / totals.inputTokens) * 100)
      : null
  const reasoningPct =
    totals.reasoningTokens > 0 && totals.outputTokens > 0
      ? Math.round((totals.reasoningTokens / totals.outputTokens) * 100)
      : null

  return (
    <div className="border-t border-border pt-2">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-[var(--vy-tracking)] text-muted">
        Step usage
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        {totals.steps > 0 ? (
          <>
            <dt className="text-muted">Steps reported</dt>
            <dd className="tabular-nums text-fg">{totals.steps}</dd>
          </>
        ) : null}
        {totals.outputTokens > 0 ? (
          <>
            <dt className="text-muted">Output tokens</dt>
            <dd className="tabular-nums text-fg">{formatTokens(totals.outputTokens)}</dd>
          </>
        ) : null}
        {totals.reasoningTokens > 0 ? (
          <>
            <dt className="text-muted">Reasoning</dt>
            <dd className="tabular-nums text-fg">
              {formatTokens(totals.reasoningTokens)}
              {reasoningPct != null ? (
                <span className="text-muted"> ({reasoningPct}% of output)</span>
              ) : null}
            </dd>
          </>
        ) : null}
        {cachePct != null ? (
          <>
            <dt className="text-muted">Prompt cache</dt>
            <dd className="tabular-nums text-fg">
              {cachePct}% ({formatTokens(totals.cachedInputTokens)} /{' '}
              {formatTokens(totals.inputTokens)})
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}

function ContextMeterPanel({
  usage,
  onCompact,
  compacting,
  compactMessage,
  compactFailed
}: {
  usage: ContextUsageState
  onCompact?: () => void
  compacting?: boolean
  compactMessage?: string | null
  compactFailed?: boolean
}) {
  // The bar and the compaction marker must share a denominator, and the trigger
  // is defined as a fraction of the content window, not the raw context window.
  const denominator = usage.contentWindow > 0 ? usage.contentWindow : usage.window
  const ratio = Math.min(1, usage.used / denominator)
  const pct = Math.round(ratio * 100)
  const compactionPct = Math.min(
    100,
    Math.round((usage.compactionTrigger / denominator) * 100)
  )
  const estimateDelta =
    usage.inputTokens != null && usage.inputTokens !== usage.estimatedTokens
      ? usage.inputTokens - usage.estimatedTokens
      : null
  const consumedLayers = usage.layers.system + usage.layers.history + usage.layers.tools

  return (
    <div className="flex flex-col gap-3 p-3 text-left">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-fg">Context window</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
              usage.source === 'provider'
                ? 'bg-success/15 text-success'
                : 'bg-warning/15 text-warning'
            )}
          >
            {usage.source === 'provider' ? 'Provider' : 'Estimated'}
          </span>
        </div>
        <p className="text-lg font-semibold tabular-nums text-fg">
          {pct}%
          <span className="ml-1 text-sm font-normal text-muted">
            · {formatTokens(usage.used)} / {formatTokens(denominator)}
          </span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted">
          Step {usage.step} · {formatTokens(usage.window)} model window, {formatTokens(usage.layers.buffer)} held
          back as buffer
        </p>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            ratio >= 0.9 ? 'bg-danger' : ratio >= 0.7 ? 'bg-warning' : 'bg-success'
          )}
          style={{ width: `${pct}%` }}
        />
        {compactionPct > 0 ? (
          <div
            className="absolute inset-y-0 w-px bg-fg/40"
            style={{ left: `${compactionPct}%` }}
            title={`Compaction at ${formatTokens(usage.compactionTrigger)}`}
          />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-muted">
          Compaction triggers at {formatTokens(usage.compactionTrigger)} (
          {formatPct(usage.compactionTrigger, denominator)} of content budget)
        </p>
        {onCompact ? (
          <button
            type="button"
            onClick={onCompact}
            disabled={compacting}
            className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-fg vy-transition hover:bg-surface disabled:opacity-[var(--vy-disabled-opacity)]"
          >
            {compacting ? 'Compacting…' : 'Compact now'}
          </button>
        ) : null}
      </div>
      {compactMessage ? (
        <p
          className={cn('text-[10px]', compactFailed ? 'text-danger' : 'text-secondary')}
          role={compactFailed ? 'alert' : 'status'}
        >
          {compactMessage}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[var(--vy-tracking)] text-muted">
          Layer breakdown
        </p>
        <LayerRow label="System" tokens={usage.layers.system} total={denominator} />
        <LayerRow label="History" tokens={usage.layers.history} total={denominator} />
        <LayerRow label="Tools" tokens={usage.layers.tools} total={denominator} />
        <LayerRow
          label="Buffer"
          tokens={usage.layers.buffer}
          total={usage.window}
          hint="(reserved, outside the bar above)"
        />
        <p className="text-[10px] text-muted">
          Consumed layers: {formatTokens(consumedLayers)} · buffer is allocation, not usage
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px]">
        <dt className="text-muted">Estimate</dt>
        <dd className="tabular-nums text-fg">{formatTokens(usage.estimatedTokens)}</dd>
        {usage.inputTokens != null ? (
          <>
            <dt className="text-muted">Provider input</dt>
            <dd className="tabular-nums text-fg">{formatTokens(usage.inputTokens)}</dd>
          </>
        ) : null}
        {estimateDelta != null ? (
          <>
            <dt className="text-muted">Delta</dt>
            <dd
              className={cn(
                'tabular-nums',
                estimateDelta > 0 ? 'text-warning' : 'text-success'
              )}
            >
              {estimateDelta > 0 ? '+' : ''}
              {formatTokens(estimateDelta)}
            </dd>
          </>
        ) : null}
      </dl>

      <StepUsageSection totals={usage.stepUsage} />

      <p className="text-[10px] text-muted">
        Updated {new Date(usage.updatedAt).toLocaleTimeString()}
      </p>
    </div>
  )
}

export function ContextMeter({
  usage,
  onCompact,
  className
}: {
  usage: ContextUsageState | null
  /** Summarize the run's older history on demand; omitted when no run exists. */
  onCompact?: () => Promise<{ ok: true; message: string } | { ok: false; message: string }>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [compactMessage, setCompactMessage] = useState<string | null>(null)
  const [compactFailed, setCompactFailed] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const { position } = useDropdownMenu({
    open,
    onOpenChange: setOpen,
    triggerRef,
    panelRef,
    placement: 'up',
    align: 'end',
    disabled: !usage
  })

  const runCompaction = async (): Promise<void> => {
    if (!onCompact || compacting) return
    setCompacting(true)
    setCompactMessage(null)
    setCompactFailed(false)
    try {
      const result = await onCompact()
      setCompactMessage(result.message)
      setCompactFailed(!result.ok)
    } finally {
      setCompacting(false)
    }
  }

  if (!usage || usage.window <= 0) return null

  const denominator = usage.contentWindow > 0 ? usage.contentWindow : usage.window
  const ratio = Math.min(1, usage.used / denominator)
  const pct = Math.round(ratio * 100)
  const barColor =
    ratio >= 0.9 ? 'bg-danger' : ratio >= 0.7 ? 'bg-warning' : 'bg-success'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'flex min-w-[7rem] max-w-[10rem] flex-col gap-0.5 rounded-md px-1 py-0.5 text-left vy-transition hover:bg-surface',
          className
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        aria-label={`Context window ${pct}% full. Open breakdown.`}
        onClick={() => setOpen((v) => !v)}
      >
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
          role="presentation"
        >
          <div
            className={cn('h-full rounded-full transition-all duration-300', barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] leading-none tracking-[var(--vy-tracking)] text-muted">
          {pct}% ctx{usage.source === 'estimate' ? ' ~' : ''}
        </span>
      </button>

      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label="Context window breakdown"
              className="z-dropdown max-h-[min(70vh,28rem)] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg"
              style={{
                position: 'fixed',
                top: position.placement === 'up' ? undefined : position.top,
                bottom:
                  position.placement === 'up'
                    ? window.innerHeight - position.top
                    : undefined,
                right: window.innerWidth - position.left,
                width: Math.max(position.minWidth, 280),
                maxWidth: 320
              }}
            >
              <ContextMeterPanel
                usage={usage}
                onCompact={onCompact ? () => void runCompaction() : undefined}
                compacting={compacting}
                compactMessage={compactMessage}
                compactFailed={compactFailed}
              />
            </div>,
            document.body
          )
        : null}
    </>
  )
}
