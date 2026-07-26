import type { ToolApprovalMode } from '@shared/ipc'
import { Input, Menu, Button } from '@renderer/lib/ui'
import type { SettingsFormState } from '../hooks/useSettingsForm'
import { TOOL_APPROVAL_OPTIONS } from '../constants'
import { SettingsRow } from '../components/SettingsRow'

export function AgentSection({ form }: { form: SettingsFormState }) {
  return (
    <>
      {form.workspaceOverrideActive ? (
        <p className="m-0 mb-3 rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-secondary">
          Editing this workspace’s overrides. Changes here apply only while the override is on.
        </p>
      ) : null}

      <SettingsRow
        title="Max steps"
        description="Maximum agent tool loop iterations per run (1–100)."
      >
        <Input
          type="number"
          className="w-24"
          aria-label="Max steps"
          min={1}
          max={100}
          disabled={form.formLocked}
          defaultValue={form.agentMaxSteps}
          key={`max-steps-${form.agentMaxSteps}-${form.workspaceOverrideActive}`}
          aria-invalid={form.errorField === 'maxSteps' ? true : undefined}
          aria-describedby={form.errorField === 'maxSteps' ? 'max-steps-error' : undefined}
          onBlur={(e) => {
            form.commitNumberField('maxSteps', e.target, {
              label: 'Max steps',
              min: 1,
              max: 100,
              integer: true,
              current: form.agentMaxSteps,
              apply: (maxSteps) => ({ maxSteps }),
              persist: (partial) => {
                void form.runAgentUpdate(partial)
              }
            })
          }}
        />
        {form.fieldError('maxSteps', 'max-steps-error')}
      </SettingsRow>

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
