import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/ui'
import { Icon } from '@renderer/lib/icons'
import { FileBadge } from './FileBadge'
import { DiffPreview, type DiffLayout } from './DiffPreview'
import { basename, parseUnifiedDiff, type DiffLine } from '../toolUi'

/** Normalized file entry for git or PR change lists. */
export type BrowserFileEntry = {
  path: string
  /** Letter shown in the tree column. */
  statusLetter: 'A' | 'M' | 'D' | 'R' | 'C' | '?'
  /** Flat-list badge text (New / Deleted / Modified / …). */
  statusLabel: string | null
  statusTone?: 'success' | 'muted'
  added: number
  removed: number
  binary?: boolean
  staged?: boolean
  unstaged?: boolean
}

export type BrowserTreeDir = {
  kind: 'dir'
  name: string
  path: string
  children: BrowserTreeNode[]
  added: number
  removed: number
}

export type BrowserTreeFile = {
  kind: 'file'
  name: string
  path: string
  file: BrowserFileEntry
}

export type BrowserTreeNode = BrowserTreeDir | BrowserTreeFile

export function buildFileTree(files: BrowserFileEntry[]): BrowserTreeNode[] {
  type MutableDir = {
    kind: 'dir'
    name: string
    path: string
    children: Map<string, MutableDir | BrowserTreeFile>
    added: number
    removed: number
  }

  const root: MutableDir = {
    kind: 'dir',
    name: '',
    path: '',
    children: new Map(),
    added: 0,
    removed: 0
  }

  const ensureDir = (parent: MutableDir, name: string): MutableDir => {
    const dirPath = parent.path ? `${parent.path}/${name}` : name
    const existing = parent.children.get(name)
    if (existing && existing.kind === 'dir') return existing
    const dir: MutableDir = {
      kind: 'dir',
      name,
      path: dirPath,
      children: new Map(),
      added: 0,
      removed: 0
    }
    parent.children.set(name, dir)
    return dir
  }

  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length === 0) continue
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      node = ensureDir(node, parts[i]!)
    }
    const name = parts[parts.length - 1]!
    node.children.set(name, { kind: 'file', name, path: file.path, file })
  }

  const freeze = (dir: MutableDir): BrowserTreeDir => {
    const children: BrowserTreeNode[] = [...dir.children.values()]
      .map((child) => {
        if (child.kind === 'file') return child
        return freeze(child)
      })
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    let added = 0
    let removed = 0
    for (const child of children) {
      if (child.kind === 'file') {
        added += child.file.added
        removed += child.file.removed
      } else {
        added += child.added
        removed += child.removed
      }
    }
    return { kind: 'dir', name: dir.name, path: dir.path, children, added, removed }
  }

  return freeze(root).children
}

function statusLetterClass(letter: BrowserFileEntry['statusLetter']): string {
  if (letter === 'A') return 'text-success'
  if (letter === 'D') return 'text-danger'
  return 'text-muted'
}

function FileDiffBody({
  path,
  binary,
  expanded,
  fetchDiff,
  layout,
  wordWrap,
  findQuery
}: {
  path: string
  binary?: boolean
  expanded: boolean
  fetchDiff: (path: string) => Promise<{ content: string } | { error: string }>
  layout: DiffLayout
  wordWrap: boolean
  findQuery: string
}) {
  const [lines, setLines] = useState<DiffLine[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setLoading(true)
    setDiffError(null)
    void fetchDiff(path)
      .then((res) => {
        if (cancelled) return
        if ('error' in res) {
          setLines([])
          setDiffError(res.error)
          return
        }
        setDiffError(null)
        setLines(parseUnifiedDiff(res.content))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, path, fetchDiff])

  if (!expanded) return null
  return (
    <div className="border-t border-border/40 bg-surface-2/30 px-2 py-1">
      {loading ? (
        <p className="m-0 px-1 py-1 text-[11px] text-muted">Loading diff…</p>
      ) : lines && lines.length > 0 ? (
        <DiffPreview
          lines={lines}
          path={path}
          expanded
          layout={layout}
          findQuery={findQuery}
          wordWrap={wordWrap}
        />
      ) : (
        <p className="m-0 px-1 py-1 text-[11px] text-muted">
          {diffError ? diffError : binary ? 'Binary file' : 'No textual diff'}
        </p>
      )}
    </div>
  )
}

function StageControls({
  file,
  busy,
  onStage,
  onUnstage,
  canStage,
  canUnstage
}: {
  file: BrowserFileEntry
  busy?: boolean
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  canStage: (file: BrowserFileEntry) => boolean
  canUnstage: (file: BrowserFileEntry) => boolean
}) {
  const showStage = canStage(file)
  const showUnstage = canUnstage(file)
  if (!showStage && !showUnstage) return null
  return (
    <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      {showStage ? (
        <button
          type="button"
          className="rounded px-1 text-[10px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          disabled={busy}
          title="Stage file"
          aria-label={`Stage ${file.path}`}
          onClick={() => onStage(file.path)}
        >
          +
        </button>
      ) : null}
      {showUnstage ? (
        <button
          type="button"
          className="rounded px-1 text-[10px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          disabled={busy}
          title="Unstage file"
          aria-label={`Unstage ${file.path}`}
          onClick={() => onUnstage(file.path)}
        >
          −
        </button>
      ) : null}
    </span>
  )
}

function FlatFileRow({
  file,
  selected,
  expanded,
  onSelect,
  onToggle,
  fetchDiff,
  layout,
  wordWrap,
  findQuery,
  stageActions,
  viewed,
  onToggleViewed,
  trailing
}: {
  file: BrowserFileEntry
  selected: boolean
  expanded: boolean
  onSelect: () => void
  onToggle: () => void
  fetchDiff: (path: string) => Promise<{ content: string } | { error: string }>
  layout: DiffLayout
  wordWrap: boolean
  findQuery: string
  stageActions?: {
    busy?: boolean
    onStage: (path: string) => void
    onUnstage: (path: string) => void
    canStage: (file: BrowserFileEntry) => boolean
    canUnstage: (file: BrowserFileEntry) => boolean
  }
  viewed?: boolean
  onToggleViewed?: () => void
  trailing?: ReactNode
}) {
  return (
    <li
      className={cn(
        'min-w-0 border-b border-border/40 last:border-b-0',
        selected && 'bg-accent/10'
      )}
    >
      <div className="flex w-full min-w-0 items-center gap-1 px-2 py-1 text-xs hover:bg-surface/60">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => {
            onSelect()
            onToggle()
          }}
          aria-expanded={expanded}
        >
          <span className="shrink-0 text-tertiary">{expanded ? '▾' : '▸'}</span>
          <FileBadge path={file.path} />
          <span className="min-w-0 flex-1 truncate text-fg" title={file.path}>
            {basename(file.path)}
          </span>
          <span className="shrink-0 tabular-nums">
            {file.added > 0 ? <span className="text-success">+{file.added}</span> : null}
            {file.removed > 0 ? (
              <span className="ml-1 text-danger">-{file.removed}</span>
            ) : null}
          </span>
          {file.statusLabel ? (
            <span
              className={cn(
                'shrink-0 text-[10px]',
                file.statusTone === 'success' ? 'text-success' : 'text-muted'
              )}
            >
              {file.statusLabel}
            </span>
          ) : null}
        </button>
        {stageActions ? (
          <StageControls file={file} {...stageActions} />
        ) : null}
        {onToggleViewed ? (
          <input
            type="checkbox"
            className="size-3.5 shrink-0 accent-accent"
            checked={Boolean(viewed)}
            aria-label={`Mark ${file.path} as viewed`}
            onChange={onToggleViewed}
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
        {trailing}
      </div>
      <FileDiffBody
        path={file.path}
        binary={file.binary}
        expanded={expanded}
        fetchDiff={fetchDiff}
        layout={layout}
        wordWrap={wordWrap}
        findQuery={findQuery}
      />
    </li>
  )
}

function TreeNodes({
  nodes,
  depth,
  folderOpen,
  selectedPath,
  onSelect,
  onToggleFolder,
  stageActions
}: {
  nodes: BrowserTreeNode[]
  depth: number
  folderOpen: Set<string>
  selectedPath: string | null
  onSelect: (path: string) => void
  onToggleFolder: (path: string) => void
  stageActions?: {
    busy?: boolean
    onStage: (path: string) => void
    onUnstage: (path: string) => void
    canStage: (file: BrowserFileEntry) => boolean
    canUnstage: (file: BrowserFileEntry) => boolean
  }
}) {
  return (
    <ul className="m-0 list-none p-0">
      {nodes.map((node) => {
        if (node.kind === 'dir') {
          const open = folderOpen.has(node.path)
          return (
            <li key={`d:${node.path}`} className="min-w-0">
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-1 px-1.5 py-0.5 text-left text-[11px] hover:bg-surface/60"
                style={{ paddingLeft: 6 + depth * 10 }}
                onClick={() => onToggleFolder(node.path)}
                aria-expanded={open}
              >
                <span className="shrink-0 text-tertiary">{open ? '▾' : '▸'}</span>
                <Icon name="folder" size={12} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-fg">{node.name}</span>
                <span className="shrink-0 tabular-nums text-[10px]">
                  {node.added > 0 ? <span className="text-success">+{node.added}</span> : null}
                  {node.removed > 0 ? (
                    <span className="ml-0.5 text-danger">-{node.removed}</span>
                  ) : null}
                </span>
              </button>
              {open ? (
                <TreeNodes
                  nodes={node.children}
                  depth={depth + 1}
                  folderOpen={folderOpen}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  onToggleFolder={onToggleFolder}
                  stageActions={stageActions}
                />
              ) : null}
            </li>
          )
        }
        const selected = selectedPath === node.path
        return (
          <li key={`f:${node.path}`} className="min-w-0">
            <div
              className={cn(
                'flex w-full min-w-0 items-center gap-1 px-1.5 py-0.5 text-[11px] hover:bg-surface/60',
                selected && 'bg-accent/10'
              )}
              style={{ paddingLeft: 6 + depth * 10 }}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                onClick={() => onSelect(node.path)}
              >
                <span
                  className={cn(
                    'w-3 shrink-0 text-center font-mono text-[10px]',
                    statusLetterClass(node.file.statusLetter)
                  )}
                >
                  {node.file.statusLetter}
                </span>
                <FileBadge path={node.path} />
                <span className="min-w-0 flex-1 truncate text-fg" title={node.path}>
                  {node.name}
                </span>
                <span className="shrink-0 tabular-nums text-[10px]">
                  {node.file.added > 0 ? (
                    <span className="text-success">+{node.file.added}</span>
                  ) : null}
                  {node.file.removed > 0 ? (
                    <span className="ml-0.5 text-danger">-{node.file.removed}</span>
                  ) : null}
                </span>
              </button>
              {stageActions ? <StageControls file={node.file} {...stageActions} /> : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Dual-pane changed-files browser: flat list (left) + folder tree (right).
 * Diff expansion is shared via `expanded` / `onToggleExpand`.
 */
export function ChangedFilesBrowser({
  files,
  totals,
  header,
  expanded,
  onToggleExpand,
  selectedPath,
  onSelectPath,
  fetchDiff,
  layout,
  wordWrap,
  findQuery,
  stageActions,
  viewedPaths,
  onToggleViewed,
  className
}: {
  files: BrowserFileEntry[]
  totals?: { added: number; removed: number }
  header?: ReactNode
  expanded: Set<string>
  onToggleExpand: (path: string) => void
  selectedPath: string | null
  onSelectPath: (path: string) => void
  fetchDiff: (path: string) => Promise<{ content: string } | { error: string }>
  layout: DiffLayout
  wordWrap: boolean
  findQuery: string
  stageActions?: {
    busy?: boolean
    onStage: (path: string) => void
    onUnstage: (path: string) => void
    canStage: (file: BrowserFileEntry) => boolean
    canUnstage: (file: BrowserFileEntry) => boolean
  }
  viewedPaths?: Set<string>
  onToggleViewed?: (path: string) => void
  className?: string
}) {
  const tree = useMemo(() => buildFileTree(files), [files])
  const [folderOpen, setFolderOpen] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    // Open all folders that contain currently visible files.
    const next = new Set<string>()
    for (const file of files) {
      const parts = file.path.replace(/\\/g, '/').split('/').filter(Boolean)
      let acc = ''
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i]!
        next.add(acc)
      }
    }
    setFolderOpen(next)
  }, [files])

  const toggleFolder = useCallback((path: string) => {
    setFolderOpen((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const added = totals?.added ?? files.reduce((s, f) => s + f.added, 0)
  const removed = totals?.removed ?? files.reduce((s, f) => s + f.removed, 0)

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-border/50 bg-surface',
        className
      )}
    >
      <div className="border-b border-border/40 px-3 py-1.5 text-[11px] text-fg">
        {header ?? (
          <>
            {files.length} {files.length === 1 ? 'File Changed' : 'Files Changed'}
            {added > 0 ? <span className="ml-2 text-success">+{added}</span> : null}
            {removed > 0 ? <span className="ml-1 text-danger">-{removed}</span> : null}
          </>
        )}
      </div>
      <div className="grid min-h-0 grid-cols-1 divide-y divide-border/40 md:grid-cols-2 md:divide-x md:divide-y-0">
        <ul className="m-0 max-h-[min(60vh,28rem)] list-none overflow-auto p-0">
          {files.map((file) => (
            <FlatFileRow
              key={file.path}
              file={file}
              selected={selectedPath === file.path}
              expanded={expanded.has(file.path)}
              onSelect={() => onSelectPath(file.path)}
              onToggle={() => onToggleExpand(file.path)}
              fetchDiff={fetchDiff}
              layout={layout}
              wordWrap={wordWrap}
              findQuery={findQuery}
              stageActions={stageActions}
              viewed={viewedPaths?.has(file.path)}
              onToggleViewed={onToggleViewed ? () => onToggleViewed(file.path) : undefined}
            />
          ))}
        </ul>
        <div className="max-h-[min(60vh,28rem)] overflow-auto py-1">
          <p className="m-0 px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
            Tree
          </p>
          <TreeNodes
            nodes={tree}
            depth={0}
            folderOpen={folderOpen}
            selectedPath={selectedPath}
            onSelect={(path) => {
              onSelectPath(path)
              if (!expanded.has(path)) onToggleExpand(path)
            }}
            onToggleFolder={toggleFolder}
            stageActions={stageActions}
          />
        </div>
      </div>
    </div>
  )
}
