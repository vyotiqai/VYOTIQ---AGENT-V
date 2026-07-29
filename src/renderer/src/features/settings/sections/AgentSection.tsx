import type { ProviderId, TerminalShell, ToolApprovalMode } from '@shared/ipc'
import { defaultModelFor } from '@shared/providers'
import { Input, Menu, Button } from '@renderer/lib/ui'
import type { SettingsFormState } from '../hooks/useSettingsForm'
import {
  ACTIVE_PROVIDER_OPTIONS,
  TERMINAL_SHELL_OPTIONS,
  TOOL_APPROVAL_OPTIONS
} from '../constants'
import { SettingsRow } from '../components/SettingsRow'

const SUBAGENT_PROVIDER_OPTIONS = [
  { value: '', label: 'Same as agent' },
  ...ACTIVE_PROVIDER_OPTIONS
]

export function AgentSection({ form }: { form: SettingsFormState }) {
  const subagentProviderOverride = form.displaySubagentProvider
  const blankModelHint = subagentProviderOverride
    ? `Blank uses ${defaultModelFor(subagentProviderOverride)} (default for that provider)`
    : `Blank uses the agent model (${form.displayModel})`
  const modelPlaceholder = subagentProviderOverride
    ? `Default for provider (${defaultModelFor(subagentProviderOverride)})`
    : `Same as agent (${form.displayModel})`

  return (
    <>
      {form.workspaceOverrideActive ? (
        <p className="m-0 mb-3 rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-secondary">
          Editing this workspace’s overrides. Changes here apply only while the override is on.
        </p>
      ) : null}

      <SettingsRow
        title="Compaction trigger"
        description="Context usage ratio that triggers compaction (0.5–0.95)."
      >
        <Input
          type="number"
          className="w-24"
          aria-label="Compaction trigger ratio"
          min={0.5}
          max={0.95}
          step={0.05}
          disabled={form.formLocked}
          defaultValue={form.agentCompactionTriggerRatio}
          key={`compaction-${form.agentCompactionTriggerRatio}-${form.workspaceOverrideActive}`}
          aria-invalid={form.errorField === 'compaction' ? true : undefined}
          aria-describedby={form.errorField === 'compaction' ? 'compaction-error' : undefined}
          onBlur={(e) => {
            form.commitNumberField('compaction', e.target, {
              label: 'Compaction trigger ratio',
              min: 0.5,
              max: 0.95,
              current: form.agentCompactionTriggerRatio,
              apply: (compactionTriggerRatio) => ({ compactionTriggerRatio }),
              persist: (partial) => {
                void form.runAgentUpdate(partial)
              }
            })
          }}
        />
        {form.fieldError('compaction', 'compaction-error')}
      </SettingsRow>

      <SettingsRow
        title="Keep recent turns"
        description="Recent conversation turns preserved during compaction (4–50)."
      >
        <Input
          type="number"
          className="w-24"
          aria-label="Keep recent turns"
          min={4}
          max={50}
          disabled={form.formLocked}
          defaultValue={form.agentKeepRecentTurns}
          key={`keep-turns-${form.agentKeepRecentTurns}-${form.workspaceOverrideActive}`}
          aria-invalid={form.errorField === 'keepTurns' ? true : undefined}
          aria-describedby={form.errorField === 'keepTurns' ? 'keep-turns-error' : undefined}
          onBlur={(e) => {
            form.commitNumberField('keepTurns', e.target, {
              label: 'Keep recent turns',
              min: 4,
              max: 50,
              integer: true,
              current: form.agentKeepRecentTurns,
              apply: (keepRecentTurns) => ({ keepRecentTurns }),
              persist: (partial) => {
                void form.runAgentUpdate(partial)
              }
            })
          }}
        />
        {form.fieldError('keepTurns', 'keep-turns-error')}
      </SettingsRow>

      <SettingsRow
        title="Sub-agent provider"
        description="Optional provider for read-only sub-agents. Leave on “Same as agent” to inherit the active provider."
      >
        <Menu
          aria-label="Sub-agent provider"
          value={form.displaySubagentProvider ?? ''}
          options={SUBAGENT_PROVIDER_OPTIONS}
          searchable={false}
          placement="down"
          disabled={form.formLocked}
          onChange={(v) => {
            const subagentProvider = v ? (v as ProviderId) : undefined
            void form.runAgentUpdate({ subagentProvider })
          }}
        />
      </SettingsRow>

      <SettingsRow
        title="Sub-agent model"
        description={blankModelHint}
      >
        <Input
          className="w-[240px] max-w-[46vw]"
          aria-label="Sub-agent model"
          placeholder={modelPlaceholder}
          disabled={form.formLocked}
          defaultValue={form.displaySubagentModel ?? ''}
          key={`subagent-model-${form.displaySubagentModel ?? ''}-${form.workspaceOverrideActive}`}
          onBlur={(e) => {
            const raw = e.target.value.trim()
            void form.runAgentUpdate({ subagentModel: raw || undefined })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </SettingsRow>

      <SettingsRow
        title="Tool approval"
        description="Ask before the agent runs tools. Off by default; allowlisted tools never ask."
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Menu
              aria-label="Tool approval"
              value={form.toolApproval.mode}
              options={TOOL_APPROVAL_OPTIONS}
              searchable={false}
              placement="down"
              disabled={form.formLocked}
              onChange={(v) => {
                void form.runAgentUpdate({
                  toolApproval: { ...form.toolApproval, mode: v as ToolApprovalMode }
                })
              }}
            />
            {form.toolApproval.allowlist.length > 0 ? (
              <Button
                variant="subtle"
                disabled={form.formLocked}
                onClick={() => {
                  void form.runAgentUpdate({
                    toolApproval: { ...form.toolApproval, allowlist: [] }
                  })
                }}
              >
                Clear {form.toolApproval.allowlist.length} allowed
              </Button>
            ) : null}
          </div>
          {form.toolApproval.allowlist.length > 0 ? (
            <ul className="m-0 list-inside list-disc pl-1 text-xs text-tertiary">
              {form.toolApproval.allowlist.map((name) => (
                <li key={name} className="font-mono">
                  {name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </SettingsRow>

      <SettingsRow
        title="Terminal shell"
        description="Shell for the terminal tool. Auto prefers PowerShell on Windows when available. Global setting (not per-workspace)."
      >
        <Menu
          aria-label="Terminal shell"
          value={form.settings.terminalShell ?? 'auto'}
          options={TERMINAL_SHELL_OPTIONS}
          searchable={false}
          placement="down"
          disabled={form.formLocked}
          onChange={(v) => {
            void form.runUpdate({ terminalShell: v as TerminalShell })
          }}
        />
      </SettingsRow>

      <SettingsRow
        title="Diagnostics command"
        description="Optional override for the diagnostics tool typecheck. Leave blank to auto-detect (package scripts or tsc). Global setting."
      >
        <Input
          className="w-full max-w-md"
          placeholder="e.g. pnpm typecheck"
          disabled={form.formLocked}
          value={form.settings.diagnosticsCommand ?? ''}
          onChange={(e) => {
            void form.runUpdate({ diagnosticsCommand: e.target.value })
          }}
        />
      </SettingsRow>

      <SettingsRow
        title="Auto-promote memory"
        description="Write compaction facts into workspace memory."
      >
        <label className="inline-flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            className="size-3.5 accent-fg"
            aria-label="Auto-promote memory"
            disabled={form.formLocked}
            checked={form.agentMemoryAutoPromote}
            onChange={(e) => {
              void form.runAgentUpdate({ memoryAutoPromote: e.target.checked })
            }}
          />
          {form.agentMemoryAutoPromote ? 'On' : 'Off'}
        </label>
      </SettingsRow>
    </>
  )
}
