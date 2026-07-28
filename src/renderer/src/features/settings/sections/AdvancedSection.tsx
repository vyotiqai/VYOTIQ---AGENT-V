import type { McpServer, Settings } from '@shared/ipc'
import { Button } from '@renderer/lib/ui'
import type { SettingsFormState } from '../hooks/useSettingsForm'
import { SettingsRow } from '../components/SettingsRow'
import { McpServerCard } from '../components/McpServerCard'

export function AdvancedSection({
  settings,
  form
}: {
  settings: Settings
  form: SettingsFormState
}) {
  const manualServers = settings.mcpServers.filter((server) => server.source !== 'marketplace')

  return (
    <>
      <SettingsRow
        stacked
        title="MCP servers"
        description="Manual MCP servers (stdio / HTTP / SSE). Prefer Settings → Marketplace for installable packages and remote MCP URLs. Tools are namespaced as mcp__serverId__toolName. Enabled servers connect automatically and their tools load into the agent."
      >
        <div className="flex w-full flex-col gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="subtle"
              disabled={form.formLocked || form.mcpStatusLoading}
              onClick={() => {
                void form.loadMcpStatus(true)
              }}
            >
              {form.mcpStatusLoading ? 'Refreshing…' : 'Refresh connections'}
            </Button>
          </div>
          {manualServers.map((server) => (
            <McpServerCard
              key={server.id}
              server={server}
              status={form.mcpStatusById.get(server.id)}
              disabled={form.formLocked}
              onUpdate={async (next) => {
                const updated = settings.mcpServers.map((s) =>
                  s.id === server.id ? next : s
                )
                return form.runUpdate({ mcpServers: updated })
              }}
              onRemove={() => {
                void (async () => {
                  await window.vyotiq.mcpClearAuthToken?.(server.id)
                  await form.runUpdate({
                    mcpServers: settings.mcpServers.filter((s) => s.id !== server.id)
                  })
                })()
              }}
            />
          ))}
          {settings.mcpServers.some((s) => s.source === 'marketplace') ? (
            <p className="m-0 text-[11px] text-secondary">
              Marketplace MCP servers are managed under Settings → Marketplace (enable /
              disable / uninstall). Plugin-bundled MCP appears there under the plugin.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="subtle"
              disabled={form.formLocked}
              onClick={() => {
                const id = crypto.randomUUID()
                const next: McpServer = {
                  id,
                  name: 'New MCP server',
                  transport: 'stdio',
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
                  enabled: false,
                  source: 'manual'
                }
                void form.runUpdate({ mcpServers: [...settings.mcpServers, next] })
              }}
            >
              Add stdio MCP
            </Button>
            <Button
              variant="subtle"
              disabled={form.formLocked}
              onClick={() => {
                const id = crypto.randomUUID()
                const next: McpServer = {
                  id,
                  name: 'Remote MCP',
                  transport: 'http',
                  url: 'https://',
                  enabled: false,
                  source: 'manual'
                }
                void form.runUpdate({ mcpServers: [...settings.mcpServers, next] })
              }}
            >
              Add remote MCP (HTTP/SSE)
            </Button>
          </div>
        </div>
      </SettingsRow>
    </>
  )
}
