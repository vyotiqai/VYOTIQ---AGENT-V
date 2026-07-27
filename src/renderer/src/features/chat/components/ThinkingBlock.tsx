import { useEffect, useRef, useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { MarkdownContent, cn } from '@renderer/lib/ui'
import { DISCLOSURE_ROW } from '@renderer/lib/utils/layout'
import { shouldRenderThinking } from '@shared/transcript'
import { TextShimmer } from './TextShimmer'

/**
 * Cap the open thought body so long reasoning cannot dominate the transcript.
 * Scales with the viewport, clamped for short and tall windows.
 */
const THINKING_BODY_MAX =
  'max-h-[min(4.5rem,12vh)] sm:max-h-[min(5.5rem,14vh)] overflow-y-auto overscroll-contain'

/** Subtle but readable — dimmer than answer text-fg, brighter than gray-400 on black. */
const THINKING_INK =
  '!text-[11px] !leading-snug !text-[var(--vy-gray-500)] [&_*]:!text-[var(--vy-gray-500)] [&_a]:!underline [&_a]:!decoration-[var(--vy-gray-500)]'

export function ThinkingBlock({
  content,
  streaming,
  expanded,
  onToggle
}: {
  content: string
  streaming?: boolean
  expanded?: boolean
  onToggle?: (next: boolean) => void
}) {
  // Cursor-style: open only while streaming so tools and the answer stay front
  // and center. Finished thought is a quiet one-line disclosure.
  const [override, setOverride] = useState<boolean | null>(null)
  const isExpanded = expanded ?? override ?? streaming === true
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isExpanded || !streaming) return
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [content, isExpanded, streaming])

  if (!shouldRenderThinking(content, streaming)) return null

  const toggle = (): void => {
    const next = !isExpanded
    setOverride(next)
    onToggle?.(next)
  }

  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        className={cn(DISCLOSURE_ROW, 'text-[var(--vy-gray-500)]')}
        aria-expanded={isExpanded}
        onClick={toggle}
      >
        {streaming ? (
          <TextShimmer className="font-medium text-[var(--vy-gray-500)]">Thinking</TextShimmer>
        ) : (
          <span className="font-medium text-[var(--vy-gray-500)]">Thought</span>
        )}
        <Icon
          name="chevronRight"
          size={14}
          className={cn(
            'self-center text-[var(--vy-gray-500)]/80 vy-transition',
            isExpanded && 'rotate-90'
          )}
        />
      </button>
      {isExpanded ? (
        <div
          ref={bodyRef}
          className={cn('mt-0.5 border-l border-[var(--vy-gray-300)] pl-3', THINKING_BODY_MAX)}
        >
          <MarkdownContent content={content} streaming={streaming} className={THINKING_INK} />
        </div>
      ) : null}
    </div>
  )
}
