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
import { getToolHeaderMeta, isProminentTool } from '../toolUi'
import { TerminalBody } from '../toolUi/bodies/TerminalBody'
import type { ToolItem } from '../utils/transcriptRows'
import { useFullToolContent } from './useFullToolContent'
import { EmptyPanel } from './PanelChrome'

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
  const [agentOpen, setAgentOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const autoCreateAttemptedRef = useRef(false)
  activeIdRef.current = activeId

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

  const refreshList = useCallback(async () => {
    if (!window.vyotiq?.ptyList) {
      setError('Terminal IPC unavailable.')
      return
    }
    const res = await window.vyotiq.ptyList()
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    setSessions(res.data)
    onSessionsChange?.(res.data)
    setActiveId((cur) => {
      if (cur && res.data.some((s) => s.id === cur)) return cur
      return res.data[0]?.id ?? null
    })
  }, [onSessionsChange])

  const createSession = useCallback(async () => {
    if (!workspacePath) {
      setError('Open a workspace to start a terminal.')
      return
    }
    if (!window.vyotiq?.ptyCreate) {
      setError('Terminal IPC unavailable.')
      return
    }
    setError(null)
    const res = await window.vyotiq.ptyCreate({ workspacePath, cols: 80, rows: 24 })
    if (!res.ok) {
      setError(res.error)
      return
    }
    await refreshList()
    setActiveId(res.data.id)
  }, [workspacePath, refreshList])

  const killSession = useCallback(
    async (id: string) => {
      const res = await window.vyotiq?.ptyKill?.(id)
      if (res && !res.ok) setError(res.error)
      await refreshList()
    },
    [refreshList]
  )

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  useEffect(() => {
    if (sessions.length > 0) {
      autoCreateAttemptedRef.current = false
      return
    }
    if (!workspacePath || autoCreateAttemptedRef.current) return
    autoCreateAttemptedRef.current = true
    void createSession()
  }, [sessions.length, workspacePath, createSession])

  useEffect(() => {
    const unsubData = window.vyotiq?.onPtyData?.(({ id, data }) => {
      if (id !== activeIdRef.current) return
      termRef.current?.write(data)
    })
    const unsubExit = window.vyotiq?.onPtyExit?.(({ id }) => {
      void refreshList()
      if (id === activeIdRef.current) {
        termRef.current?.writeln('\r\n[process exited]')
      }
    })
    return () => {
      unsubData?.()
      unsubExit?.()
    }
  }, [refreshList])

  useEffect(() => {
    const el = hostRef.current
    if (!el || !activeId) return undefined

    const term = new Terminal({
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#0d0d0d',
        foreground: '#e8e8e8',
        cursor: '#e8e8e8'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(el)
    fit.fit()
    term.focus()
    termRef.current = term
    fitRef.current = fit

    const onData = term.onData((data) => {
      void window.vyotiq?.ptyWrite?.(activeId, data)
    })

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            try {
              fit.fit()
              void window.vyotiq?.ptyResize?.(activeId, term.cols, term.rows)
            } catch {
              /* ignore */
            }
          })
        : null
    ro?.observe(el)
    void window.vyotiq?.ptyResize?.(activeId, term.cols, term.rows)

    return () => {
      onData.dispose()
      ro?.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [activeId])

  const active = sessions.find((s) => s.id === activeId) ?? null

  return (
    <div
      className={cn(CHAT_RIGHT_PANEL_BODY, className)}
      data-terminal-panel
      role="region"
      aria-label="Terminal panel"
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/40 px-1 py-0.5">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={cn(
                  'group inline-flex max-w-[8rem] items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px]',
                  s.id === activeId ? 'bg-bg text-fg' : 'text-muted hover:bg-bg/50'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 truncate"
                  onClick={() => setActiveId(s.id)}
                >
                  &gt;_ {s.title}
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
          {active ? (
            <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-2.5 py-1 text-[11px] text-muted">
              <span>{active.title}</span>
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
          <div className="relative min-h-0 flex-1 bg-[#0d0d0d] p-1">
            {activeId ? (
              <div ref={hostRef} className="h-full w-full" data-pty-host />
            ) : (
              <EmptyPanel
                icon="terminal"
                title="No terminal"
                body={
                  workspacePath
                    ? 'Click + to start an interactive shell, or wait while a session is created.'
                    : 'Open a workspace to start an interactive shell.'
                }
              />
            )}
          </div>
        </div>

        <aside className="flex w-[7.5rem] shrink-0 flex-col border-l border-border/40 bg-surface">
          <p className="m-0 px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted">
            {sessions.length} Terminal{sessions.length === 1 ? '' : 's'}
          </p>
          <ul className="m-0 list-none space-y-0.5 p-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px]',
                    s.id === activeId ? 'bg-bg text-fg' : 'text-muted hover:bg-bg/50'
                  )}
                  onClick={() => setActiveId(s.id)}
                >
                  <Icon name="terminal" size={11} className="shrink-0" />
                  <span className="min-w-0 truncate">{s.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <div className="shrink-0 border-t border-border/40">
        <button
          type="button"
          className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-[11px] text-muted hover:text-fg"
          onClick={() => setAgentOpen((v) => !v)}
        >
          <Icon
            name="chevronRight"
            size={12}
            className={cn('vy-transition', agentOpen && 'rotate-90')}
          />
          Agent commands ({agentTerminals.length})
        </button>
        {agentOpen ? (
          <div className="max-h-40 overflow-auto p-2">
            {agentTerminals.length === 0 ? (
              <p className="m-0 text-[11px] text-muted">No agent terminal output yet.</p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {agentTerminals.map((item) => (
                  <AgentTerminalEntry
                    key={item.id}
                    item={item}
                    onLoadToolContent={onLoadToolContent}
                  />
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
