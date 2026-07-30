import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileChip, ImageChip, MarkdownContent, balanceIncompleteMarkdown, cn } from '@renderer/lib/ui'
import { TOOL_BODY_CLAMP_PX, USER_PROMPT_SURFACE } from '@renderer/lib/utils/layout'
import type { UserItem } from '../utils/transcriptRows'

export function UserPrompt({
  item,
  onImageClick
}: {
  item: UserItem
  onImageClick: (url: string, label: string) => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const content = useMemo(() => {
    if (!item.content) return ''
    // Preserve exactly what the model received — no paragraph dedupe.
    return balanceIncompleteMarkdown(item.content)
  }, [item.content])

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    setOverflows(el.scrollHeight > TOOL_BODY_CLAMP_PX + 8)
  }, [content])

  const clamped = overflows && !expanded

  return (
    <div className={cn(USER_PROMPT_SURFACE)}>
      {content ? (
        <div
          ref={bodyRef}
          className={cn('relative overflow-hidden', clamped && 'mask-fade-bottom')}
          style={clamped ? { maxHeight: TOOL_BODY_CLAMP_PX } : undefined}
        >
          <MarkdownContent content={content} />
        </div>
      ) : null}

      {overflows ? (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-tertiary vy-transition hover:text-fg"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}

      {item.images?.length || item.attachments?.length ? (
        <div className={cn('flex flex-wrap items-center gap-1.5', content ? 'mt-2' : null)}>
          {item.images?.map((url, imageIndex) => (
            <ImageChip
              key={`${item.id}-${imageIndex}`}
              url={url}
              label={`Image ${imageIndex + 1}`}
              onClick={() => onImageClick(url, `Image ${imageIndex + 1}`)}
            />
          ))}
          {item.attachments?.map((file, fileIndex) => (
            <FileChip
              key={`${item.id}-file-${fileIndex}`}
              name={file.name}
              chars={file.chars}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
