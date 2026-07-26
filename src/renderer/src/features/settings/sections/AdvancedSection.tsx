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
  return (
    <>
      <SettingsRow
        stacked
        title="MCP servers"
        description="External tool servers (stdio). Tools are namespaced as mcp__serverId__toolName. Agent limits are in Settings → Agent."
      >
        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center justify-end gap-2">
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
          {settings.mcpServers.map((server) => (
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
                void form.runUpdate({
                  mcpServers: settings.mcpServers.filter((s) => s.id !== server.id)
                })
              }}
            />
          ))}
          <Button
            variant="subtle"
            disabled={form.formLocked}
            onClick={() => {
              const id = crypto.randomUUID()
              const next: McpServer = {
                id,
                name: 'New MCP server',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
                enabled: false
              }
              void form.runUpdate({ mcpServers: [...settings.mcpServers, next] })
            }}
          >
            Add MCP server
          </Button>
        </div>
      </SettingsRow>
    </>
  )
}
