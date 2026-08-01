import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@renderer/lib/icons'
import { FileChip, ImageChip, MarkdownContent, balanceIncompleteMarkdown, cn } from '@renderer/lib/ui'
import { TOOL_BODY_CLAMP_PX, USER_PROMPT_SURFACE } from '@renderer/lib/utils/layout'
import type { UserItem } from '../utils/transcriptRows'

export function UserPrompt({
  item,
  onImageClick,
  editing = false,
  editComposer,
  onBeginEdit
}: {
  item: UserItem
  onImageClick: (url: string, label: string) => void
  editing?: boolean
  editComposer?: ReactNode
  onBeginEdit?: () => void
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

  if (editing && editComposer) {
    return <div className="w-full">{editComposer}</div>
  }

  const clamped = overflows && !expanded
  const editable = Boolean(onBeginEdit)

  return (
    <div
      className={cn(
        USER_PROMPT_SURFACE,
        'relative',
        editable &&
          cn(
            'group/prompt cursor-text vy-transition',
            'hover:border-border-strong hover:bg-surface/40',
            'focus-visible:vy-focus-ring'
          )
      )}
      onClick={
        editable
          ? (e) => {
              const target = e.target as HTMLElement
              if (target.closest('button, a, [data-no-prompt-edit]')) return
              onBeginEdit?.()
            }
          : undefined
      }
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      onKeyDown={
        editable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onBeginEdit?.()
              }
            }
          : undefined
      }
      aria-label={editable ? 'Edit message' : undefined}
      title={editable ? 'Click to edit' : undefined}
    >
      {editable ? (
        <span
          className={cn(
            'pointer-events-none absolute right-2 top-2 z-[1] inline-grid size-6 place-items-center rounded-md',
            'border border-border/70 bg-card/90 text-muted shadow-sm backdrop-blur-sm',
            'opacity-0 vy-transition',
            'group-hover/prompt:opacity-100 group-focus-visible/prompt:opacity-100',
            'group-focus-within/prompt:opacity-100'
          )}
          aria-hidden
        >
          <Icon name="edit" size={12} />
        </span>
      ) : null}

      {content ? (
        <div
          ref={bodyRef}
          className={cn(
            'relative overflow-hidden',
            editable && 'pr-8',
            clamped && 'mask-fade-bottom'
          )}
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
        <div
          className={cn('flex flex-wrap items-center gap-1.5', content ? 'mt-2' : null)}
          data-no-prompt-edit
        >
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
