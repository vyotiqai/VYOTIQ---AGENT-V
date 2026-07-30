import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@renderer/lib/ui'
import { Icon } from '@renderer/lib/icons'
import { IconButton } from '@renderer/lib/ui'
import { CHAT_RIGHT_PANEL_BODY } from '@renderer/lib/utils/layout'
import type { PtySessionInfo } from '@shared/ipc'
import type { UiItem } from '@shared/transcript'
import { prunePtyOutputBuffers } from '@shared/utils/ptyOutputBuffer'
import { getPtyOutputBuffers, ensurePtyOutputBufferListener } from './ptyOutputBuffers'
import { getToolHeaderMeta, isProminentTool } from '../toolUi'
import { TerminalBody } from '../toolUi/bodies/TerminalBody'
import type { ToolItem } from '../utils/transcriptRows'
import { useFullToolContent } from './useFullToolContent'
import { EmptyPanel } from './PanelChrome'

ensurePtyOutputBufferListener()

function readCssColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return value || fallback
}

function isToolItem(item: UiItem): item is ToolItem {
  return item.kind === 'tool'
}

function terminalStatusLabel(status: ToolItem['tool']['status']): string {
  switch (status) {
    case 'running':
      return 'Running'
    case 'done':
      return 'Done'
    case 'fail':
      return 'Failed'
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

function AgentTerminalEntry({
  item,
  onLoadToolContent
}: {
  item: ToolItem
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
}) {
  const enabled = item.tool.contentTruncated === true
  const { loading, failed } = useFullToolContent(item.tool, enabled, onLoadToolContent)
  const headerMeta = getToolHeaderMeta(item.tool)
  const headerLabel = [headerMeta.verb, headerMeta.target].filter(Boolean).join(' ')
  return (
    <li className="overflow-hidden rounded-md border border-border/50 bg-surface">
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px]">
        <Icon name="terminal" size={12} className="text-muted" />
        <span className="min-w-0 flex-1 truncate text-fg">
          {headerLabel || item.tool.summary || item.tool.name}
        </span>
        <span
          className={cn(
            'shrink-0 tabular-nums',
            item.tool.status === 'fail'
              ? 'text-danger'
              : item.tool.status === 'running'
                ? 'text-muted'
                : 'text-success'
          )}
        >
          {terminalStatusLabel(item.tool.status)}
        </span>
      </div>
      <TerminalBody tool={item.tool} expanded loading={loading} loadFailed={failed} />
    </li>
  )
}

/** One xterm host bound to a PTY session id. */
function PtySessionView({ sessionId }: { sessionId: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return undefined

    const term = new Terminal({
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: readCssColor('--vy-bg', '#000000'),
        foreground: readCssColor('--vy-fg', '#f5f5f5'),
        cursor: readCssColor('--vy-fg', '#f5f5f5'),
        selectionBackground: readCssColor('--vy-surface-2', '#262626'),
        black: readCssColor('--vy-bg', '#000000'),
        brightBlack: readCssColor('--vy-gray-400', '#525252')
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(el)
    const buffers = getPtyOutputBuffers()
    const buffered = buffers.get(sessionId)
    if (buffered) term.write(buffered)
    term.focus()

    const applyFit = (): void => {
      if (el.clientWidth < 2 || el.clientHeight < 2) return
      try {
        fit.fit()
        if (term.cols >= 2 && term.rows >= 2) {
          void window.vyotiq?.ptyResize?.(sessionId, term.cols, term.rows)
        }
      } catch {
        /* ignore */
      }
    }

    const onData = term.onData((data) => {
      void window.vyotiq?.ptyWrite?.(sessionId, data)
    })

    const unsubData = window.vyotiq?.onPtyData?.(({ id, data }) => {
      if (id !== sessionId) return
      term.write(data)
    })
    const unsubExit = window.vyotiq?.onPtyExit?.(({ id }) => {
      if (id !== sessionId) return
      term.writeln('\r\n[process exited]')
    })

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => applyFit()) : null
    ro?.observe(el)
    applyFit()

    return () => {
      onData.dispose()
      unsubData?.()
      unsubExit?.()
      ro?.disconnect()
      term.dispose()
    }
  }, [sessionId])

  return <div ref={hostRef} className="h-full w-full bg-bg" data-pty-host />
}

/**
 * Interactive PTY terminal panel with Cursor-like session tabs + agent command rollup.
 */
export function TerminalPanel({
  items,
  className,
  workspacePath,
  onLoadToolContent,
  onSessionsChange
}: {
  items: UiItem[]
  className?: string
  workspacePath?: string | null
  onLoadToolContent?: (toolCallId: string) => Promise<string | null>
  onSessionsChange?: (sessions: PtySessionInfo[]) => void
}) {
  const [sessions, setSessions] = useState<PtySessionInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  /** Second pane session id for side-by-side split; null = single pane. */
  const [splitId, setSplitId] = useState<string | null>(null)
  /** Right-hand session list — screenshot 1 panel toggle. */
  const [listOpen, setListOpen] = useState(true)
  const [agentOpen, setAgentOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Gate auto-create until ptyList has returned (avoids duplicate sessions on remount). */
  const [listReady, setListReady] = useState(false)
  const autoCreateAttemptedRef = useRef(false)
  /** After the user closes the last session, do not immediately spawn another. */
  const suppressAutoCreateRef = useRef(false)
  const onSessionsChangeRef = useRef(onSessionsChange)
  onSessionsChangeRef.current = onSessionsChange

  const agentTerminals = useMemo(() => {
    const out: ToolItem[] = []
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]
      if (!item || !isToolItem(item)) continue
      if (item.tool.name !== 'terminal') continue
      if (!isProminentTool(item.tool.name, item.tool.argsPreview)) continue
      out.push(item)
      if (out.length >= 8) break
    }
    return out
  }, [items])

  const usingPipeFallback = sessions.some((s) => s.backend === 'pipe')
  const activeSession = sessions.find((s) => s.id === activeId) ?? null

  const refreshList = useCallback(async () => {
    if (!window.vyotiq?.ptyList) {
      setError('Terminal IPC unavailable.')
      setListReady(true)
      return
    }
    const res = await window.vyotiq.ptyList(workspacePath ?? undefined)
    if (!res.ok) {
      setError(res.error)
      setListReady(true)
      return
    }
    setError(null)
    prunePtyOutputBuffers(
      getPtyOutputBuffers(),
      res.data.map((s) => s.id)
    )
    setSessions(res.data)
    onSessionsChangeRef.current?.(res.data)
    setActiveId((cur) => {
      if (cur && res.data.some((s) => s.id === cur)) return cur
      return res.data[0]?.id ?? null
    })
    setSplitId((cur) => {
      if (!cur) return null
      if (!res.data.some((s) => s.id === cur)) return null
      return cur
    })
    setListReady(true)
  }, [workspacePath])

  const createSession = useCallback(async (): Promise<string | null> => {
    if (!workspacePath) {
      setError('Open a workspace to start a terminal.')
      return null
    }
    if (!window.vyotiq?.ptyCreate) {
      setError('Terminal IPC unavailable.')
      return null
    }
    setError(null)
    suppressAutoCreateRef.current = false
    const res = await window.vyotiq.ptyCreate({ workspacePath, cols: 80, rows: 24 })
    if (!res.ok) {
      setError(res.error)
      return null
    }
    await refreshList()
    setActiveId(res.data.id)
    return res.data.id
  }, [workspacePath, refreshList])

  const killSession = useCallback(
    async (id: string) => {
      if (sessions.length <= 1) {
        suppressAutoCreateRef.current = true
      }
      const res = await window.vyotiq?.ptyKill?.(id)
      if (res && !res.ok) setError(res.error)
      getPtyOutputBuffers().delete(id)
      if (splitId === id) setSplitId(null)
      await refreshList()
    },
    [refreshList, sessions.length, splitId]
  )

  const toggleSplit = useCallback(async () => {
    if (splitId) {
      setSplitId(null)
      return
    }
    if (!activeId) {
      const created = await createSession()
      if (!created) return
      const other = await createSession()
      if (other) {
        setActiveId(created)
        setSplitId(other)
      }
      return
    }
    const other = sessions.find((s) => s.id !== activeId)
    if (other) {
      setSplitId(other.id)
      return
    }
    const created = await createSession()
    if (created && created !== activeId) {
      setSplitId(created)
      setActiveId(activeId)
    }
  }, [splitId, activeId, sessions, createSession])

  useEffect(() => {
    autoCreateAttemptedRef.current = false
    suppressAutoCreateRef.current = false
    setListReady(false)
    setSessions([])
    setActiveId(null)
    setSplitId(null)
    setError(null)
  }, [workspacePath])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  useEffect(() => {
    if (!listReady) return
    if (sessions.length > 0) return
    if (!workspacePath || autoCreateAttemptedRef.current || suppressAutoCreateRef.current) {
      return
    }
    autoCreateAttemptedRef.current = true
    void createSession()
  }, [listReady, sessions.length, workspacePath, createSession])

  // Buffering is owned by ptyOutputBuffers.ts (survives unmount). Panel only
  // refreshes the session list when a process exits.
  useEffect(() => {
    const unsubExit = window.vyotiq?.onPtyExit?.(() => {
      void refreshList()
    })
    return () => {
      unsubExit?.()
    }
  }, [refreshList])

  const sessionCountLabel =
    sessions.length === 1 ? '1 Terminal' : `${sessions.length} Terminals`

  return (
    <div
      className={cn(CHAT_RIGHT_PANEL_BODY, className)}
      data-terminal-panel
      role="region"
      aria-label="Terminal panel"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/40 bg-bg px-1 py-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={cn(
                  'group inline-flex max-w-[8rem] items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px]',
                  s.id === activeId
                    ? 'bg-surface text-fg'
                    : 'text-muted hover:bg-surface/60'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 truncate"
                  aria-pressed={s.id === activeId}
                  onClick={() => setActiveId(s.id)}
                >
                  &gt;_ {s.title}
                  {!s.running ? ' (exited)' : ''}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 opacity-0 hover:bg-surface-2 group-hover:opacity-100"
                  aria-label={`Close ${s.title}`}
                  onClick={() => void killSession(s.id)}
                >
                  <Icon name="close" size={10} />
                </button>
              </div>
            ))}
            <IconButton
              icon="plus"
              label="New terminal"
              variant="bare"
              size="sm"
              className="text-muted"
              onClick={() => void createSession()}
            />
          </div>
          <div className="flex shrink-0 items-center">
            <IconButton
              icon="sidebar"
              label={listOpen ? 'Hide terminal list' : 'Show terminal list'}
              variant="bare"
              size="sm"
              className={cn('text-muted', listOpen && 'text-fg')}
              onClick={() => setListOpen((v) => !v)}
            />
          </div>
        </div>
        {activeSession ? (
          <div className="flex shrink-0 items-center gap-1 border-b border-border/30 px-2.5 py-0.5">
            <p className="m-0 min-w-0 flex-1 truncate text-[11px] text-muted">
              {activeSession.title}
            </p>
            <IconButton
              icon="columns"
              label={splitId ? 'Unsplit terminals' : 'Split terminal'}
              variant="bare"
              size="sm"
              className="text-muted"
              onClick={() => void toggleSplit()}
            />
          </div>
        ) : null}
        {error ? (
          <p className="m-0 shrink-0 border-b border-border/40 px-3 py-1 text-[11px] text-danger">
            {error}
          </p>
        ) : null}
        {usingPipeFallback ? (
          <p className="m-0 shrink-0 border-b border-border/40 px-3 py-1 text-[11px] text-muted">
            Pipe shell fallback — rebuild node-pty for Electron for a full interactive PTY.
          </p>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="relative min-h-0 min-w-0 flex-1 bg-bg p-1">
            {activeId ? (
              splitId && splitId !== activeId ? (
                <div className="flex h-full min-h-0 w-full gap-1">
                  <div className="min-h-0 min-w-0 flex-1">
                    <PtySessionView sessionId={activeId} />
                  </div>
                  <div className="w-px shrink-0 bg-border/50" />
                  <div className="min-h-0 min-w-0 flex-1">
                    <PtySessionView sessionId={splitId} />
                  </div>
                </div>
              ) : (
                <PtySessionView sessionId={activeId} />
              )
            ) : (
              <EmptyPanel
                icon="terminal"
                title="No terminal"
                body={
                  workspacePath
                    ? 'Use New terminal above to start an interactive shell.'
                    : 'Open a workspace to start an interactive shell.'
                }
              />
            )}
          </div>
          {listOpen && sessions.length > 0 ? (
            <aside
              className="flex w-[7.5rem] shrink-0 flex-col overflow-hidden border-l border-border/40 bg-bg"
              data-terminal-session-list
            >
              <p className="m-0 shrink-0 truncate px-2 py-1.5 text-[11px] text-muted">
                {sessionCountLabel}
              </p>
              <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-1 truncate px-2 py-1 text-left text-[11px]',
                        s.id === activeId
                          ? 'bg-surface text-fg'
                          : 'text-muted hover:bg-surface/60 hover:text-fg'
                      )}
                      aria-pressed={s.id === activeId}
                      onClick={() => setActiveId(s.id)}
                      title={s.title}
                    >
                      <span className="min-w-0 truncate">
                        &gt;_ {s.title}
                        {!s.running ? ' (exited)' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
        </div>
      </div>

      {agentTerminals.length > 0 ? (
        <>
          <div className="flex shrink-0 items-center gap-1 border-t border-border/40 bg-bg">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 px-2.5 py-1 text-left text-[11px] text-muted hover:text-fg"
              onClick={() => setAgentOpen((v) => !v)}
            >
              <Icon
                name="chevronRight"
                size={12}
                className={cn('vy-transition', agentOpen && 'rotate-90')}
              />
              Agent commands ({agentTerminals.length})
            </button>
          </div>
          {agentOpen ? (
            <div className="max-h-40 shrink-0 overflow-auto border-t border-border/40 p-2">
              <ul className="m-0 list-none space-y-2 p-0">
                {agentTerminals.map((item) => (
                  <AgentTerminalEntry
                    key={item.id}
                    item={item}
                    onLoadToolContent={onLoadToolContent}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
