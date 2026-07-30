import { basename } from '@shared/utils/path'

export type FileBadgeInfo = {
  label: string
  className?: string
}

const BADGE_BY_EXT: Record<string, FileBadgeInfo> = {
  json: { label: '{}', className: 'text-warning border-warning/40' },
  sh: { label: '$', className: 'text-success border-success/40' },
  bash: { label: '$', className: 'text-success border-success/40' },
  zsh: { label: '$', className: 'text-success border-success/40' },
  ps1: { label: '$', className: 'text-success border-success/40' },
  md: { label: 'M↓', className: 'normal-case text-muted' },
  markdown: { label: 'M↓', className: 'normal-case text-muted' },
  ts: { label: 'TS', className: 'text-accent border-accent/40' },
  tsx: { label: 'TS', className: 'text-accent border-accent/40' },
  js: { label: 'JS', className: 'text-warning border-warning/40' },
  jsx: { label: 'JS', className: 'text-warning border-warning/40' },
  javascript: { label: 'JS', className: 'text-warning border-warning/40' },
  py: { label: 'PY' },
  yml: { label: 'YML' },
  yaml: { label: 'YML' }
}

/** Screenshot-style short mark for a path (e.g. `{}`, `$`, `M↓`, `TS`). */
export function fileBadgeInfo(path: string): FileBadgeInfo | null {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = name.slice(dot + 1).toLowerCase()
  const mapped = BADGE_BY_EXT[extension]
  if (mapped) return mapped
  if (extension && extension.length <= 4) {
    return { label: extension }
  }
  return null
}

/** String mark for callers that only need the label. */
export function fileBadge(path: string): string | null {
  return fileBadgeInfo(path)?.label ?? null
}

export { basename }
