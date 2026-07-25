import { useState } from 'react'
import { Icon } from '@renderer/lib/icons'
import { MarkdownContent, cn } from '@renderer/lib/ui'
import { DISCLOSURE_ROW } from '@renderer/lib/utils/layout'
import { isMeaningfulThinking } from '@shared/transcript'
import { TextShimmer } from './TextShimmer'

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
  // Reasoning reads itself out while it streams — that live text is the only
  // sign of life a long turn gives — then folds away once the answer takes over.
  const [override, setOverride] = useState<boolean | null>(null)
  const isExpanded = expanded ?? override ?? streaming === true

  if (!isMeaningfulThinking(content)) return null

  const toggle = (): void => {
    const next = !isExpanded
    setOverride(next)
    onToggle?.(next)
  }

  return (
    <div className="w-full">
      <button
        type="button"
        className={cn(DISCLOSURE_ROW, 'text-fg')}
        aria-expanded={isExpanded}
        onClick={toggle}
      >
        {streaming ? (
          <TextShimmer className="font-medium text-fg">Thinking</TextShimmer>
        ) : (
          <span className="font-medium text-fg">Thought</span>
        )}
        <Icon
          name="chevronRight"
          size={12}
          className={cn('self-center text-tertiary vy-transition', isExpanded && 'rotate-90')}
        />
      </button>
      {isExpanded ? (
        <div className="mt-0.5 border-l border-border pl-3 text-xs leading-relaxed text-secondary">
          <MarkdownContent content={content} streaming={streaming} />
        </div>
      ) : null}
    </div>
  )
}
