import { describe, expect, it } from 'vitest'
import {
  ChatMessageSchema,
  ChatStartRequestSchema,
  ChatStartResultSchema,
  CancelRunRequestSchema,
  CompactRunRequestSchema,
  DeleteRunRequestSchema,
  RenameRunRequestSchema,
  LoadRunEventsRequestSchema,
  ExtractAttachmentRequestSchema,
  MAX_ATTACHMENT_DATA_CHARS,
  SetSettingsRequestSchema,
  SetSecretRequestSchema,
  OpenHarnessRequestSchema,
  ListModelsRequestSchema,
  ModelInfoSchema,
  ProviderIdSchema,
  AgentEventSchema,
  WindowMaximizedChangedSchema,
  LoadRunRequestSchema,
  LoadToolResultRequestSchema,
  SettingsSchema,
  DEFAULT_SETTINGS,
  TelemetryStatusSchema,
  SECRET_PROVIDERS,
  SecretProviderSchema,
  emptySecretStatus,
  emptySecretsStatus,
  secretStatusFromKeys,
  ok,
  fail,
  MAX_IMAGE_DATA_URL_CHARS,
  contentHasImage,
  contentToText,
  ToolApprovalRequestSchema,
  ToolApprovalResponseSchema,
  ActiveRunSchema,
  GitStatusSchema
} from '@shared/ipc'
import { IPC } from '@shared/channels'
import { PROVIDER_DEFAULTS, seedModelsFor } from '@shared/providers'
import type { VyotiqApi } from '@shared/vyotiqApi'

describe('ipc schemas', () => {
  it('parses chat start with tool messages', () => {
    const messages = [
      { role: 'user' as const, content: 'hi' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: '1', name: 'read', arguments: '{"path":"a.ts"}' }]
      },
      { role: 'tool' as const, content: 'ok', toolCallId: '1', toolName: 'read' }
    ]
    const parsed = ChatStartRequestSchema.parse({ messages, workspacePath: '/ws' })
    expect(parsed.messages).toHaveLength(3)
    expect(ChatMessageSchema.parse(messages[2]).toolCallId).toBe('1')
  })

  it('rejects empty model in settings patch', () => {
    expect(() => SetSettingsRequestSchema.parse({ model: '' })).toThrow()
  })

  it('rejects whitespace-only API keys', () => {
    expect(() =>
      SetSecretRequestSchema.parse({ provider: 'openai', key: '   ' })
    ).toThrow()
  })

  it('accepts empty open harness request', () => {
    expect(OpenHarnessRequestSchema.parse({})).toEqual({})
  })

  it('parses multimodal user content parts', () => {
    const msg = ChatMessageSchema.parse({
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', url: 'data:image/png;base64,aaa' }
      ]
    })
    expect(contentHasImage(msg.content)).toBe(true)
    expect(contentToText(msg.content)).toContain('look')
  })

  it('accepts all nine providers', () => {
    for (const id of [
      'openai',
      'anthropic',
      'gemini',
      'ollama',
      'deepseek',
      'groq',
      'openrouter',
      'xai',
      'mistral'
    ]) {
      expect(ProviderIdSchema.parse(id)).toBe(id)
    }
    expect(PROVIDER_DEFAULTS).toHaveLength(9)
    expect(ListModelsRequestSchema.parse({ provider: 'groq' }).provider).toBe('groq')
    expect(IPC.listModels).toBe('models:list')
  })

  it('lists eight secret providers without ollama', () => {
    expect(SECRET_PROVIDERS).toHaveLength(8)
    expect(SECRET_PROVIDERS).not.toContain('ollama')
    expect(SecretProviderSchema.safeParse('ollama').success).toBe(false)
    expect(emptySecretStatus().openai).toBe(false)
  })

  it('keeps SecretsStatus shape (encryptionAvailable + keys)', () => {
    const unavailable = emptySecretsStatus(false)
    expect(unavailable.encryptionAvailable).toBe(false)
    expect(unavailable.keys.openai).toBe(false)
    expect(Object.keys(unavailable.keys)).toHaveLength(SECRET_PROVIDERS.length)
  })

  it('rejects oversized image_url data URLs', () => {
    const huge = 'data:image/png;base64,' + 'a'.repeat(MAX_IMAGE_DATA_URL_CHARS)
    expect(() =>
      ChatMessageSchema.parse({
        role: 'user',
        content: [{ type: 'image_url', url: huge }]
      })
    ).toThrow()
    expect(
      ChatMessageSchema.parse({
        role: 'user',
        content: [{ type: 'image_url', url: 'data:image/png;base64,aa' }]
      }).content
    ).toEqual([{ type: 'image_url', url: 'data:image/png;base64,aa' }])
  })

  it('parses cancel and agent events', () => {
    expect(CancelRunRequestSchema.parse({ runId: 'abc' })).toEqual({ runId: 'abc' })
    expect(
      AgentEventSchema.parse({
        type: 'tool_result',
        runId: 'r1',
        toolCallId: 't1',
        name: 'read',
        summary: 'a.ts',
        ok: true,
        content: 'file'
      }).type
    ).toBe('tool_result')
    expect(
      AgentEventSchema.parse({
        type: 'tool_result',
        runId: 'r1',
        toolCallId: 't1',
        name: 'read',
        summary: 'big.ts',
        ok: true,
        content: 'preview',
        contentTruncated: true
      }).contentTruncated
    ).toBe(true)
    expect(
      AgentEventSchema.parse({
        type: 'tool_call_delta',
        runId: 'r1',
        toolCallId: 't1',
        argumentsDelta: '{"path":'
      }).type
    ).toBe('tool_call_delta')
    expect(
      AgentEventSchema.parse({
        type: 'assistant_message',
        runId: 'r1',
        content: '',
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }]
      }).toolCalls
    ).toHaveLength(1)
    expect(
      AgentEventSchema.parse({
        type: 'text_delta',
        runId: 'r1',
        text: 'hi'
      }).text
    ).toBe('hi')
    expect(
      AgentEventSchema.parse({
        type: 'thinking_delta',
        runId: 'r1',
        text: 'reason',
        step: 1
      }).type
    ).toBe('thinking_delta')
    expect(
      AgentEventSchema.parse({
        type: 'thinking_done',
        runId: 'r1',
        text: 'done reasoning',
        step: 1
      }).text
    ).toBe('done reasoning')
    expect(
      AgentEventSchema.parse({
        type: 'error',
        runId: 'r1',
        message: 'Stopped after 25 steps.',
        code: 'AGENT_MAX_STEPS'
      })
    ).toEqual({
      type: 'error',
      runId: 'r1',
      message: 'Stopped after 25 steps.',
      code: 'AGENT_MAX_STEPS'
    })
    expect(
      AgentEventSchema.parse({
        type: 'step_usage',
        runId: 'r1',
        step: 2,
        inputTokens: 1000,
        outputTokens: 50,
        cachedInputTokens: 800
      }).cachedInputTokens
    ).toBe(800)
    expect(
      AgentEventSchema.parse({
        type: 'context_usage',
        runId: 'r1',
        step: 1,
        estimatedTokens: 1200,
        inputTokens: 1100,
        contextWindow: 128000,
        compactionTrigger: 70000,
        source: 'provider',
        layers: { system: 100, history: 900, tools: 200, buffer: 0 }
      }).source
    ).toBe('provider')
    expect(
      AgentEventSchema.parse({
        type: 'error',
        runId: 'r1',
        message: 'boom'
      }).code
    ).toBeUndefined()
    expect(
      AgentEventSchema.parse({
        type: 'stream_reset',
        runId: 'r1',
        step: 2
      }).type
    ).toBe('stream_reset')
    expect(
      AgentEventSchema.parse({
        type: 'incomplete',
        runId: 'r1',
        reason: 'empty_response',
        step: 1,
        message: 'The model returned an empty response.'
      }).reason
    ).toBe('empty_response')
    expect(
      AgentEventSchema.parse({
        type: 'subagent_update',
        runId: 'r1',
        parentToolCallId: 'c1',
        kind: 'tool',
        text: 'read a.ts'
      }).parentToolCallId
    ).toBe('c1')
    expect(WindowMaximizedChangedSchema.parse(true)).toBe(true)
    expect(LoadRunRequestSchema.parse({ workspacePath: '/ws', runId: 'r1' })).toEqual({
      workspacePath: '/ws',
      runId: 'r1'
    })
    expect(
      LoadToolResultRequestSchema.parse({
        workspacePath: '/ws',
        runId: 'r1',
        toolCallId: 'call-1'
      })
    ).toEqual({
      workspacePath: '/ws',
      runId: 'r1',
      toolCallId: 'call-1'
    })
  })

  it('rejects run ids that can escape the sessions directory', () => {
    const traversals = ['..', '../../..', '../sibling', '..\\..\\secrets', '/etc/passwd', 'C:\\Windows', 'a/b', '']
    const runScoped = [
      { schema: LoadRunRequestSchema, base: { workspacePath: '/ws' } },
      { schema: LoadRunEventsRequestSchema, base: { workspacePath: '/ws' } },
      { schema: LoadToolResultRequestSchema, base: { workspacePath: '/ws', toolCallId: 'c1' } },
      { schema: DeleteRunRequestSchema, base: { workspacePath: '/ws' } },
      { schema: RenameRunRequestSchema, base: { workspacePath: '/ws', goal: 'g' } },
      { schema: CompactRunRequestSchema, base: { workspacePath: '/ws' } },
      { schema: CancelRunRequestSchema, base: {} }
    ]
    for (const { schema, base } of runScoped) {
      for (const runId of traversals) {
        expect(schema.safeParse({ ...base, runId }).success).toBe(false)
      }
      expect(schema.safeParse({ ...base, runId: '3f2a8c1e-0b7d-4a11-9d0e-2c1f5b6a7c88' }).success).toBe(
        true
      )
    }
    expect(
      ChatStartRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'hi' }],
        workspacePath: '/ws',
        runId: '../../..'
      }).success
    ).toBe(false)
  })

  it('caps attachment payload size before main decodes it', () => {
    const oversized = 'a'.repeat(MAX_ATTACHMENT_DATA_CHARS + 1)
    expect(
      ExtractAttachmentRequestSchema.safeParse({ name: 'big.txt', mime: 'text/plain', data: oversized })
        .success
    ).toBe(false)
    expect(
      ExtractAttachmentRequestSchema.parse({ name: 'a.txt', mime: 'text/plain', data: 'aGk=' }).data
    ).toBe('aGk=')
  })

  it('maps secret key names to provider booleans', () => {
    const status = secretStatusFromKeys(['openai', 'groq', 'not-a-provider'])
    expect(status.openai).toBe(true)
    expect(status.groq).toBe(true)
    expect(status.anthropic).toBe(false)
    expect(Object.keys(status)).toHaveLength(SECRET_PROVIDERS.length)
  })

  it('wraps ipc ok/fail helpers', () => {
    expect(ok({ runId: 'x' })).toEqual({ ok: true, data: { runId: 'x' } })
    expect(fail('nope')).toEqual({ ok: false, error: 'nope' })
  })

  it('seeds deepseek without legacy chat ids', () => {
    const seeds = seedModelsFor('deepseek')
    expect(seeds.every((m) => !m.id.includes('deepseek-chat'))).toBe(true)
    expect(ModelInfoSchema.parse(seeds[0]).supportsTools).toBe(true)
  })

  it('keeps DEFAULT_SETTINGS aligned with SettingsSchema (incl. telemetry)', () => {
    const parsed = SettingsSchema.parse(DEFAULT_SETTINGS)
    expect(parsed).toEqual(DEFAULT_SETTINGS)
    expect(parsed.telemetryEnabled).toBe(false)
    // Legacy settings files omit telemetryEnabled — default fills it
    const legacy = SettingsSchema.parse({
      provider: 'ollama',
      model: 'qwen2.5',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      maxSteps: 25,
      theme: 'system'
    })
    expect(legacy.telemetryEnabled).toBe(false)
    expect(SetSettingsRequestSchema.parse({ telemetryEnabled: true })).toEqual({
      telemetryEnabled: true
    })
  })

  it('parses model picker preference fields on settings', () => {
    const parsed = SettingsSchema.parse({
      ...DEFAULT_SETTINGS,
      favoriteModels: ['openai:gpt-4o'],
      recentModels: ['anthropic:claude-sonnet-4', 'openai:gpt-4o'],
      thinkingPrefsByProvider: {
        openai: { thinkingEnabled: true, thinkingEffort: 'high' }
      },
      serviceTierByModel: { 'openai:gpt-4o': 'priority' },
      serviceTier: 'flex'
    })
    expect(parsed.favoriteModels).toEqual(['openai:gpt-4o'])
    expect(parsed.recentModels).toHaveLength(2)
    expect(parsed.thinkingPrefsByProvider.openai?.thinkingEffort).toBe('high')
    expect(parsed.serviceTierByModel['openai:gpt-4o']).toBe('priority')
    expect(parsed.serviceTier).toBe('flex')
    expect(() =>
      SettingsSchema.parse({ ...DEFAULT_SETTINGS, recentModels: Array(6).fill('openai:a') })
    ).toThrow()
  })

  it('parses telemetry status payload', () => {
    expect(
      TelemetryStatusSchema.parse({ dsnConfigured: true, telemetryEnabled: false })
    ).toEqual({ dsnConfigured: true, telemetryEnabled: false })
    expect(() => TelemetryStatusSchema.parse({ dsnConfigured: true })).toThrow()
  })

  it('exposes logging IPC channels used by VyotiqApi', () => {
    expect(IPC.logsOpenDir).toBe('logs:open-dir')
    expect(IPC.logsGetPath).toBe('logs:get-path')
    expect(IPC.telemetryStatus).toBe('telemetry:status')
    // Compile-time surface check — method names must exist on VyotiqApi
    const apiKeys: (keyof VyotiqApi)[] = [
      'openLogsDir',
      'getLogsPath',
      'telemetryStatus'
    ]
    expect(apiKeys).toHaveLength(3)
  })

  it('requires invokeId on chat start results and active runs', () => {
    expect(ChatStartResultSchema.parse({ runId: 'r1', invokeId: 1 })).toEqual({
      runId: 'r1',
      invokeId: 1
    })
    expect(() => ChatStartResultSchema.parse({ runId: 'r1' })).toThrow()
    expect(
      ActiveRunSchema.parse({ runId: 'r1', workspacePath: '/ws', invokeId: 2 })
    ).toEqual({ runId: 'r1', workspacePath: '/ws', invokeId: 2 })
    expect(() => ActiveRunSchema.parse({ runId: 'r1', workspacePath: '/ws' })).toThrow()
  })

  it('parses tool approval request/response and git status shapes', () => {
    expect(
      ToolApprovalRequestSchema.parse({
        requestId: 'req-1',
        runId: 'r1',
        toolCallId: 'c1',
        name: 'edit',
        summary: 'a.ts',
        argsPreview: '{}',
        mutating: true
      }).name
    ).toBe('edit')
    expect(
      ToolApprovalResponseSchema.parse({
        requestId: 'req-1',
        decision: 'once'
      })
    ).toEqual({ requestId: 'req-1', decision: 'once' })
    expect(
      GitStatusSchema.parse({
        branch: 'main',
        fileCount: 1,
        added: 2,
        removed: 0,
        truncated: false,
        hasRemote: true,
        hasCommits: true,
        files: [
          {
            path: 'a.ts',
            status: 'modified',
            added: 2,
            removed: 0,
            binary: false
          }
        ]
      }).branch
    ).toBe('main')
  })
})
