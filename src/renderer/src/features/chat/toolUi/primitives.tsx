import { useState } from 'react'
import { FileTypeIcon } from '@renderer/lib/fileIcons'
import { Icon } from '@renderer/lib/icons'
import { TOOL_BODY_INNER, TOOL_BODY_PAD } from '@renderer/lib/utils/layout'
import { cn } from '@renderer/lib/ui'

export function TruncatedBanner({
  loading,
  failed
}: {
  loading: boolean
  failed: boolean
}) {
  return (
    <p className="m-0 px-3 py-1 text-[10px] text-tertiary">
      {loading
        ? 'Loading full output…'
        : failed
          ? 'Could not load full output.'
          : 'Showing truncated preview…'}
    </p>
  )
}

export function CodeBlock({
  lines,
  startLine = 1,
  className
}: {
  lines: string[]
  startLine?: number
  className?: string
}) {
  if (!lines.length) return null

  return (
    <div
      className={cn(
        'overflow-x-auto font-mono text-[11px] leading-[1.6]',
        TOOL_BODY_PAD,
        className
      )}
    >
      {lines.map((text, index) => (
        <div key={index} className="flex min-w-0 gap-2">
          <span className="w-8 shrink-0 select-none text-right tabular-nums text-tertiary">
            {startLine + index}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap text-fg/80 [overflow-wrap:anywhere]">
            {text || '\u00a0'}
          </span>
        </div>
      ))}
    </div>
  )
}

export function PathList({ paths }: { paths: string[] }) {
  if (!paths.length) {
    return <p className={cn(TOOL_BODY_PAD, 'm-0 text-[11px] text-tertiary')}>No matches</p>
  }

  return (
    <ul className={cn(TOOL_BODY_INNER, 'm-0 max-h-48 list-none overflow-auto p-0')}>
      {paths.map((path) => (
        <li key={path} className="group flex min-w-0 items-center gap-1.5 py-0.5">
          <FileTypeIcon path={path} size={14} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg/80" title={path}>
            {path}
          </span>
          <CopyButton
            text={path}
            className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
          />
        </li>
      ))}
    </ul>
  )
}

export function DirListing({
  entries
}: {
  entries: { kind: 'dir' | 'file'; name: string; size: string }[]
}) {
  if (!entries.length) {
    return <p className={cn(TOOL_BODY_PAD, 'm-0 text-[11px] text-tertiary')}>Empty directory</p>
  }

  return (
    <div className={cn(TOOL_BODY_INNER, 'max-h-48 overflow-auto')}>
      {entries.map((entry) => (
        <div
          key={entry.name}
          className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 py-0.5 font-mono text-[11px]"
        >
          <FileTypeIcon
            path={entry.name}
            kind={entry.kind === 'dir' ? 'folder' : 'file'}
            size={14}
          />
          <span className="min-w-0 truncate text-fg/80" title={entry.name}>
            {entry.name}
            {entry.kind === 'dir' ? '/' : ''}
          </span>
          <span className="min-w-[3rem] text-right tabular-nums text-tertiary">{entry.size}</span>
        </div>
      ))}
    </div>
  )
}

export function MatchList({
  groups
}: {
  groups: { file: string; matches: { line: number; text: string; isMatch: boolean }[] }[]
}) {
  if (!groups.length) {
    return <p className={cn(TOOL_BODY_PAD, 'm-0 text-[11px] text-tertiary')}>No matches</p>
  }

  return (
    <div className={cn(TOOL_BODY_INNER, 'flex max-h-48 flex-col gap-2 overflow-auto')}>
      {groups.map((group) => (
        <div key={group.file}>
          <div
            className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[10px] font-medium text-tertiary"
            title={group.file}
          >
            <FileTypeIcon path={group.file} size={12} />
            <span className="min-w-0 truncate">{group.file}</span>
          </div>
          {group.matches.map((match) => (
            <div
              key={`${group.file}:${match.line}`}
              className="grid grid-cols-[auto_1fr] gap-x-2 py-px font-mono text-[11px]"
            >
              <span className="tabular-nums text-tertiary">{match.line}</span>
              <span
                className={
                  match.isMatch
                    ? 'whitespace-pre-wrap text-fg [overflow-wrap:anywhere]'
                    : 'whitespace-pre-wrap text-fg/60 [overflow-wrap:anywhere]'
                }
              >
                {match.text}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border bg-surface-2/60 px-1.5 py-px font-mono text-[10px] text-tertiary">
      {children}
    </span>
  )
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-tertiary vy-transition hover:text-fg',
        className
      )}
      onClick={() => void copy()}
      aria-label={copied ? 'Copied' : 'Copy'}
      title={copied ? 'Copied' : 'Copy'}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
