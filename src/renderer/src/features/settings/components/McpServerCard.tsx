import { useEffect, useState } from 'react'
import type { McpServer, McpServerStatus } from '@shared/ipc'
import { Input, Textarea, Button } from '@renderer/lib/ui'
import { mcpArgsToText, mcpEnvToText, mcpTextToArgs, mcpTextToEnv } from '../utils/mcpText'
import { mcpStatusClass, mcpStatusLabel } from '../utils/settingsHelpers'

export function McpServerCard({
  server,
  status,
  disabled,
  onUpdate,
  onRemove
}: {
  server: McpServer
  status: McpServerStatus | undefined
  disabled?: boolean
  onUpdate: (next: McpServer) => Promise<boolean>
  onRemove: () => void
}) {
  const [name, setName] = useState(server.name)
  const [command, setCommand] = useState(server.command)
  const [argsText, setArgsText] = useState(mcpArgsToText(server.args))
  const [envText, setEnvText] = useState(mcpEnvToText(server.env))

  useEffect(() => {
    setName(server.name)
    setCommand(server.command)
    setArgsText(mcpArgsToText(server.args))
    setEnvText(mcpEnvToText(server.env))
  }, [server.id, server.name, server.command, server.args, server.env])

  const persist = async (patch: Partial<McpServer>): Promise<void> => {
    const next: McpServer = { ...server, ...patch }
    const ok = await onUpdate(next)
    if (!ok) {
      setName(server.name)
      setCommand(server.command)
      setArgsText(mcpArgsToText(server.args))
      setEnvText(mcpEnvToText(server.env))
    }
  }

  const commitName = (): void => {
    const trimmed = name.trim()
    if (!trimmed) {
      setName(server.name)
      return
    }
    if (trimmed !== server.name) void persist({ name: trimmed })
  }

  const commitCommand = (): void => {
    const trimmed = command.trim()
    if (!trimmed) {
      setCommand(server.command)
      return
    }
    if (trimmed !== server.command) void persist({ command: trimmed })
  }

  const commitArgs = (): void => {
    const nextArgs = mcpTextToArgs(argsText)
    const prevArgs = server.args ?? []
    if (nextArgs.join('\n') === prevArgs.join('\n')) return
    void persist({ args: nextArgs.length > 0 ? nextArgs : undefined })
  }

  const commitEnv = (): void => {
    const nextEnv = mcpTextToEnv(envText)
    const prevEnv = server.env ?? {}
    const prevText = Object.entries(prevEnv)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
    const nextText = nextEnv
      ? Object.entries(nextEnv)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')
      : ''
    if (nextText === prevText) return
    void persist({ env: nextEnv })
  }

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 truncate text-secondary" title={server.id}>
          ID: {server.id}
        </p>
        <label className="inline-flex shrink-0 items-center gap-1.5 text-secondary">
          <input
            type="checkbox"
            className="size-3.5 accent-fg"
            checked={server.enabled}
            disabled={disabled}
            aria-label={`Enable MCP server ${server.name}`}
            onChange={(e) => {
              void persist({ enabled: e.target.checked })
            }}
          />
          Enabled
        </label>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <Input
          className="w-full"
          aria-label={`MCP server name for ${server.id}`}
          placeholder="Server name"
          disabled={disabled}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <Input
          className="w-full font-mono"
          aria-label={`MCP command for ${server.id}`}
          placeholder="Command (e.g. npx)"
          disabled={disabled}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onBlur={commitCommand}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <div className="rounded-md border border-border bg-surface px-2.5 py-1">
          <Textarea
            className="min-h-[52px] font-mono text-xs"
            aria-label={`MCP arguments for ${server.id}`}
            placeholder="Arguments (one per line)"
            disabled={disabled}
            rows={3}
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            onBlur={commitArgs}
          />
        </div>
        <div className="rounded-md border border-border bg-surface px-2.5 py-1">
          <Textarea
            className="min-h-[52px] font-mono text-xs"
            aria-label={`MCP environment for ${server.id}`}
            placeholder="Environment (KEY=value, one per line)"
            disabled={disabled}
            rows={2}
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            onBlur={commitEnv}
          />
        </div>
      </div>

      <p className={`m-0 mt-2 ${mcpStatusClass(status)}`}>{mcpStatusLabel(status)}</p>
      {status?.error ? (
        <p className="m-0 mt-1 text-danger [overflow-wrap:anywhere]">{status.error}</p>
      ) : null}

      <Button variant="subtle" className="mt-2" disabled={disabled} onClick={onRemove}>
        Remove
      </Button>
    </div>
  )
}
