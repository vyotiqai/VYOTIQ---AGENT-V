import { z } from 'zod'
import { AgentInteractionModeSchema } from './settings'

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_IMAGE_DATA_URL_CHARS = Math.ceil(MAX_IMAGE_BYTES * (4 / 3)) + 128

/** Raw bytes an attachment may carry before extraction; PDFs are the heavy case. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
/** Base64 of `MAX_ATTACHMENT_BYTES`, rejected before main allocates the buffer. */
export const MAX_ATTACHMENT_DATA_CHARS = Math.ceil(MAX_ATTACHMENT_BYTES * (4 / 3)) + 128
/** Extracted text kept per attachment, so one document cannot eat the context. */
export const MAX_ATTACHMENT_CHARS = 120_000

/** Inline audio for providers that accept audio data URLs / inline bytes. */
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024
export const MAX_AUDIO_DATA_URL_CHARS = Math.ceil(MAX_AUDIO_BYTES * (4 / 3)) + 128
/** Native PDF/document bytes sent without text extraction. */
export const MAX_NATIVE_FILE_BYTES = 8 * 1024 * 1024
export const MAX_NATIVE_FILE_DATA_CHARS = Math.ceil(MAX_NATIVE_FILE_BYTES * (4 / 3)) + 128

/**
 * A run id becomes a directory name under the workspace sessions root, so it must
 * never contain a separator or a `..` segment. Generated ids are UUIDs.
 */
export const RunIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/, 'Invalid run id')
  .refine((value) => value !== '.' && value !== '..', 'Invalid run id')

export const ContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image_url'),
    url: z.string().min(1).max(MAX_IMAGE_DATA_URL_CHARS)
  }),
  z.object({
    /** A document the user attached, already reduced to text in the main process. */
    type: z.literal('file'),
    name: z.string().min(1).max(400),
    mime: z.string().max(200),
    text: z.string().max(MAX_ATTACHMENT_CHARS)
  }),
  z.object({
    type: z.literal('audio'),
    url: z.string().min(1).max(MAX_AUDIO_DATA_URL_CHARS),
    mime: z.string().max(200).optional()
  }),
  z.object({
    /** Native document bytes for providers that accept PDF/file on the wire. */
    type: z.literal('file_native'),
    name: z.string().min(1).max(400),
    mime: z.string().max(200),
    data: z.string().min(1).max(MAX_NATIVE_FILE_DATA_CHARS)
  })
])
export type ContentPart = z.infer<typeof ContentPartSchema>

export const MessageContentSchema = z.union([z.string(), z.array(ContentPartSchema).min(1)])
export type MessageContent = z.infer<typeof MessageContentSchema>

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: MessageContentSchema,
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  /** Whether the tool call succeeded; persisted for accurate reload without events.jsonl. */
  ok: z.boolean().optional(),
  /** Renderer history contains a preview; full tool output remains on disk. */
  contentTruncated: z.boolean().optional(),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.string()
      })
    )
    .optional(),
  /** Display/summary thinking text for UI replay (not injected into compaction). */
  thinking: z.string().optional(),
  /** Opaque provider reasoning replay state for multi-turn tool loops. */
  reasoningState: z.unknown().optional()
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const RunStatusSchema = z.object({
  status: z.enum(['running', 'cancelled', 'error', 'done']),
  step: z.number().int().min(0).default(0),
  updatedAt: z.string(),
  error: z.string().optional(),
  goal: z.string().optional(),
  workspacePath: z.string().optional(),
  /** Latest chatStart invocation represented by outcome fields. */
  invokeId: z.number().int().min(1).optional(),
  /** Last Ask / Plan / Agent mode for this run (survives resume). */
  mode: AgentInteractionModeSchema.optional(),
  /** Consecutive all-failure tool steps — restored across invokes. */
  consecutiveToolFailureSteps: z.number().int().min(0).optional()
})
export type RunStatus = z.infer<typeof RunStatusSchema>

export function IpcResultSchema<T extends z.ZodTypeAny>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({
      ok: z.literal(false),
      error: z.string(),
      code: z.string().optional()
    })
  ])
}

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

/**
 * Why a turn ended without finishing its work. Drives the Continue affordance:
 * the run is over, but the model was cut off rather than done.
 */
export const IncompleteReasonSchema = z.enum([
  'truncated',
  'empty_response',
  'filtered',
  'context_overflow'
])
export type IncompleteReason = z.infer<typeof IncompleteReasonSchema>

/**
 * Fields on every agent event. `invokeId` identifies the chatStart invoke that produced
 * the event: a run is reused across turns, so runId alone cannot tell a live event apart
 * from one arriving late from the previous turn.
 */
const eventBase = {
  runId: z.string(),
  invokeId: z.number().int().min(1).optional()
}

export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text_delta'),
    ...eventBase,
    text: z.string()
  }),
  z.object({
    type: z.literal('thinking_delta'),
    ...eventBase,
    text: z.string(),
    step: z.number().int().min(1).optional()
  }),
  z.object({
    type: z.literal('thinking_done'),
    ...eventBase,
    text: z.string().optional(),
    step: z.number().int().min(1).optional()
  }),
  z.object({
    type: z.literal('tool_start'),
    ...eventBase,
    toolCallId: z.string(),
    name: z.string(),
    summary: z.string()
  }),
  z.object({
    type: z.literal('tool_call_delta'),
    ...eventBase,
    toolCallId: z.string(),
    name: z.string().optional(),
    argumentsDelta: z.string()
  }),
  z.object({
    type: z.literal('tool_result'),
    ...eventBase,
    toolCallId: z.string(),
    name: z.string(),
    summary: z.string(),
    ok: z.boolean(),
    content: z.string().optional(),
    /** IPC preview was capped; full output is on disk until lazy-loaded. */
    contentTruncated: z.boolean().optional()
  }),
  z.object({
    /** Live progress from a nested sub-agent, shown under the calling tool row. */
    type: z.literal('subagent_update'),
    ...eventBase,
    parentToolCallId: z.string(),
    kind: z.enum(['text', 'thinking', 'tool', 'done']),
    text: z.string()
  }),
  z.object({
    /** Incremental stdout/stderr from a running terminal tool call (not persisted). */
    type: z.literal('terminal_output_delta'),
    ...eventBase,
    toolCallId: z.string(),
    text: z.string(),
    stream: z.enum(['stdout', 'stderr']).optional()
  }),
  z.object({
    type: z.literal('subagent_context_usage'),
    ...eventBase,
    parentToolCallId: z.string(),
    step: z.number().int().min(1),
    estimatedTokens: z.number().int().min(0),
    contextWindow: z.number().int().min(1),
    contentWindow: z.number().int().min(1).optional(),
    model: z.string()
  }),
  z.object({
    /**
     * Full nested-agent event mirrored under the parent `subagent` tool row.
     * Prefer this over expanding `subagent_update` kinds.
     */
    type: z.literal('subagent_event'),
    ...eventBase,
    parentToolCallId: z.string(),
    subagentId: z.string().min(1),
    /**
     * Nested payload (any AgentEvent except another `subagent_event`).
     * Loose object parse — emitters must not wrap recursively.
     */
    event: z.object({ type: z.string() }).passthrough()
  }),
  z.object({
    type: z.literal('status'),
    ...eventBase,
    status: z.enum(['running', 'cancelled', 'error', 'done'])
  }),
  z.object({
    type: z.literal('error'),
    ...eventBase,
    message: z.string(),
    code: z.string().optional()
  }),
  z.object({
    type: z.literal('assistant_message'),
    ...eventBase,
    content: z.string(),
    thinking: z.string().optional(),
    toolCalls: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          arguments: z.string()
        })
      )
      .optional()
  }),
  z.object({
    type: z.literal('compaction'),
    ...eventBase,
    summary: z.string(),
    tokenEstimate: z.number().int().min(0).optional()
  }),
  z.object({
    type: z.literal('incomplete'),
    ...eventBase,
    reason: IncompleteReasonSchema,
    step: z.number().int().min(1).optional(),
    /** Human-readable explanation shown next to the Continue action. */
    message: z.string()
  }),
  z.object({
    /**
     * A retry is about to re-stream this step from scratch. The renderer must drop
     * the text and thinking it already showed, or the retried output appends to it.
     */
    type: z.literal('stream_reset'),
    ...eventBase,
    step: z.number().int().min(1)
  }),
  z.object({
    type: z.literal('step_usage'),
    ...eventBase,
    step: z.number().int().min(1),
    inputTokens: z.number().int().min(0).optional(),
    outputTokens: z.number().int().min(0).optional(),
    cachedInputTokens: z.number().int().min(0).optional(),
    reasoningTokens: z.number().int().min(0).optional()
  }),
  z.object({
    type: z.literal('context_usage'),
    ...eventBase,
    step: z.number().int().min(1),
    estimatedTokens: z.number().int().min(0),
    inputTokens: z.number().int().min(0).optional(),
    contextWindow: z.number().int().min(1),
    contentWindow: z.number().int().min(1).optional(),
    compactionTrigger: z.number().int().min(0),
    source: z.enum(['estimate', 'provider']),
    /** True when estimated tokens still exceed the model window after compaction/trim. */
    overflow: z.boolean().optional(),
    /** Estimate-only layer split; omit when source is provider (totals are not layer-aligned). */
    layers: z
      .object({
        system: z.number().int().min(0),
        history: z.number().int().min(0),
        tools: z.number().int().min(0),
        buffer: z.number().int().min(0)
      })
      .optional()
  }),
  z.object({
    /** Agent switched Ask / Plan / Agent mid-run; composer syncs from this. */
    type: z.literal('mode_changed'),
    ...eventBase,
    mode: AgentInteractionModeSchema
  }),
  z.object({
    /** Turn-level snapshot of agent file writes; used for Undo on the Files Changed card. */
    type: z.literal('writes_checkpoint'),
    ...eventBase,
    checkpointId: z.string().min(1),
    /** True after Keep all / Discard all / Undo fully resolves the checkpoint. */
    undone: z.boolean().optional(),
    files: z.array(
      z.object({
        path: z.string().min(1),
        action: z.enum(['created', 'modified', 'deleted']),
        undoable: z.boolean(),
        resolved: z.enum(['kept', 'discarded']).optional()
      })
    )
  }),
  z.object({
    /** Mid-run follow-up accepted into the active run queue. */
    type: z.literal('follow_up_queued'),
    ...eventBase,
    id: z.string().min(1),
    position: z.number().int().min(1),
    queueLength: z.number().int().min(0),
    preview: z.string().optional()
  }),
  z.object({
    /** Mid-run follow-ups drained into the live message history. */
    type: z.literal('follow_up_applied'),
    ...eventBase,
    ids: z.array(z.string().min(1)).min(1),
    messages: z.array(ChatMessageSchema).min(1)
  })
])
export type AgentEvent = z.infer<typeof AgentEventSchema>

export const ChatStartResultSchema = z.object({
  runId: z.string(),
  invokeId: z.number().int().min(1)
})
export type ChatStartResult = z.infer<typeof ChatStartResultSchema>

export const RunSummarySchema = z.object({
  runId: z.string(),
  status: z.enum(['running', 'cancelled', 'error', 'done']),
  updatedAt: z.string(),
  goal: z.string().optional()
})
export type RunSummary = z.infer<typeof RunSummarySchema>

export const ListRunsResultSchema = z.object({
  runs: z.array(RunSummarySchema),
  capped: z.boolean()
})
export type ListRunsResult = z.infer<typeof ListRunsResultSchema>

export const PersistedEventSchema = z.object({
  at: z.string(),
  event: z.unknown()
})
export type PersistedEvent = z.infer<typeof PersistedEventSchema>

export const LoadRunEventsRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: RunIdSchema
})
export type LoadRunEventsRequest = z.infer<typeof LoadRunEventsRequestSchema>

export const ChatStartRequestSchema = z
  .object({
    messages: z.array(ChatMessageSchema).optional(),
    newMessages: z.array(ChatMessageSchema).optional(),
    incremental: z.boolean().optional(),
    workspacePath: z.string().min(1),
    runId: RunIdSchema.optional(),
    /** Ask / Plan / Agent — authoritative for this invoke. */
    mode: AgentInteractionModeSchema.optional()
  })
  .superRefine((val, ctx) => {
    if (val.incremental) {
      if (!val.runId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'incremental requires runId',
          path: ['runId']
        })
      }
      if (!val.newMessages?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'incremental requires newMessages',
          path: ['newMessages']
        })
      }
      return
    }
    if (!val.messages?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'messages required when not incremental',
        path: ['messages']
      })
    }
  })
export type ChatStartRequest = z.infer<typeof ChatStartRequestSchema>

export const CancelRunRequestSchema = z.object({
  runId: RunIdSchema
})

export const ChatFollowUpRequestSchema = z.object({
  runId: RunIdSchema,
  message: ChatMessageSchema.refine((m) => m.role === 'user', {
    message: 'Follow-up must be a user message'
  })
})
export type ChatFollowUpRequest = z.infer<typeof ChatFollowUpRequestSchema>

export const ChatFollowUpResultSchema = z.object({
  id: z.string().min(1),
  position: z.number().int().min(1),
  queueLength: z.number().int().min(0)
})
export type ChatFollowUpResult = z.infer<typeof ChatFollowUpResultSchema>

export const ChatFollowUpRemoveRequestSchema = z.object({
  runId: RunIdSchema,
  id: z.string().min(1)
})
export type ChatFollowUpRemoveRequest = z.infer<typeof ChatFollowUpRemoveRequestSchema>

export const ChatFollowUpRemoveResultSchema = z.object({
  removed: z.boolean(),
  queueLength: z.number().int().min(0)
})
export type ChatFollowUpRemoveResult = z.infer<typeof ChatFollowUpRemoveResultSchema>

export const CompactRunRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: RunIdSchema
})
export type CompactRunRequest = z.infer<typeof CompactRunRequestSchema>

export const CompactRunResultSchema = z.object({
  summary: z.string(),
  tokenEstimate: z.number().int().min(0),
  /** Messages the working set was reduced to, for the confirmation message. */
  keptMessages: z.number().int().min(0),
  messagesBefore: z.number().int().min(0),
  /** Post-compact estimate for the live context meter. */
  estimatedTokens: z.number().int().min(0).optional(),
  contextWindow: z.number().int().min(1).optional(),
  contentWindow: z.number().int().min(1).optional()
})
export type CompactRunResult = z.infer<typeof CompactRunResultSchema>

export const UndoWritesRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: RunIdSchema,
  checkpointId: z.string().min(1).optional()
})
export type UndoWritesRequest = z.infer<typeof UndoWritesRequestSchema>

export const UndoWritesResultSchema = z.object({
  checkpointId: z.string().min(1),
  restored: z.array(z.string()),
  skipped: z.array(z.string())
})
export type UndoWritesResult = z.infer<typeof UndoWritesResultSchema>

export const ResolveWritesRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: RunIdSchema,
  checkpointId: z.string().min(1).optional(),
  action: z.enum(['keep', 'discard']),
  /** When omitted, applies to all unresolved files. */
  paths: z.array(z.string().min(1)).optional()
})
export type ResolveWritesRequest = z.infer<typeof ResolveWritesRequestSchema>

export const ResolveWritesResultSchema = z.object({
  checkpointId: z.string().min(1),
  kept: z.array(z.string()),
  discarded: z.array(z.string()),
  skipped: z.array(z.string()),
  fullyResolved: z.boolean()
})
export type ResolveWritesResult = z.infer<typeof ResolveWritesResultSchema>

/** Run-dir artifacts readable via `runs:readArtifact`. */
export const RunArtifactNameSchema = z.enum([
  'plan.md',
  'contract.md',
  'receipt.json',
  'browser/snapshot.jpg',
  'trajectory.jsonl',
  'prediction.json'
])
export type RunArtifactName = z.infer<typeof RunArtifactNameSchema>

export const TRAJECTORY_FILENAME = 'trajectory.jsonl' as const
export const PREDICTION_FILENAME = 'prediction.json' as const
export const PREDICTION_MANIFEST_VERSION = 1 as const

/** One observational row in trajectory.jsonl (derived from events.jsonl). */
export const TrajectoryRowSchema = z.object({
  at: z.string().optional(),
  step: z.number().int().min(0),
  kind: z.string().min(1),
  tool: z.string().optional(),
  toolCallId: z.string().optional(),
  ok: z.boolean().optional(),
  summary: z.string().optional(),
  reason: z.string().optional(),
  status: z.string().optional(),
  mode: z.string().optional(),
  parentToolCallId: z.string().optional(),
  subagentKind: z.string().optional(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  estimatedTokens: z.number().int().min(0).optional(),
  overflow: z.boolean().optional(),
  fileCount: z.number().int().min(0).optional()
})
export type TrajectoryRow = z.infer<typeof TrajectoryRowSchema>

/** Observational prediction manifest — never auto-applied to harness sections. */
export const PredictionEntrySchema = z.object({
  at: z.string().min(1),
  step: z.number().int().min(0).optional(),
  type: z.literal('harness_section'),
  target: z.enum(['context', 'tool_policy', 'memory', 'work_style']),
  bucket: z
    .enum(['system_prompt', 'tool_policy', 'loop_notices', 'memory'])
    .optional(),
  confidence: z.number().min(0).max(1),
  observed_only: z.literal(true),
  reason: z.string().optional()
})
export type PredictionEntry = z.infer<typeof PredictionEntrySchema>

export const PredictionManifestSchema = z.object({
  version: z.literal(PREDICTION_MANIFEST_VERSION),
  runId: z.string().min(1),
  writtenAt: z.string().min(1),
  observed_only: z.literal(true),
  predictions: z.array(PredictionEntrySchema)
})
export type PredictionManifest = z.infer<typeof PredictionManifestSchema>

/** Per-run receipt.json written at agent loop teardown. */
export const RUN_RECEIPT_VERSION = 5 as const

export const RunReceiptToolStatSchema = z.object({
  ok: z.number().int().min(0),
  failed: z.number().int().min(0)
})
export type RunReceiptToolStat = z.infer<typeof RunReceiptToolStatSchema>

export const RunReceiptSubagentSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['ok', 'failed']),
  reportPath: z.string().min(1)
})
export type RunReceiptSubagent = z.infer<typeof RunReceiptSubagentSchema>

export const RunReceiptSchema = z.object({
  version: z.literal(RUN_RECEIPT_VERSION),
  writtenAt: z.string().min(1),
  runId: z.string().min(1),
  status: z.enum(['running', 'cancelled', 'error', 'done']),
  step: z.number().int().min(0),
  goal: z.string().optional(),
  mode: z.string().optional(),
  consecutiveToolFailureSteps: z.number().int().min(0).optional(),
  statusError: z.string().optional(),
  incomplete: z
    .object({
      reason: IncompleteReasonSchema,
      message: z.string().optional()
    })
    .optional(),
  tokenUsage: z
    .object({
      inputTokens: z.number().int().min(0).optional(),
      outputTokens: z.number().int().min(0).optional()
    })
    .optional(),
  compactionCount: z.number().int().min(0),
  toolStats: z.object({
    totalCalls: z.number().int().min(0),
    ok: z.number().int().min(0),
    failed: z.number().int().min(0),
    byName: z.record(z.string(), RunReceiptToolStatSchema)
  }),
  failureClusters: z.array(
    z.object({
      key: z.string(),
      count: z.number().int().min(1)
    })
  ),
  unreadEditPaths: z.array(z.string()),
  wroteFiles: z.array(z.string()),
  diagnostics: z.object({
    calls: z.number().int().min(0),
    ok: z.number().int().min(0),
    clean: z.number().int().min(0).default(0)
  }),
  contractExcerpt: z.string(),
  /** Minimal index of file-backed subagent reports under the run dir (no report mining). */
  subagents: z.array(RunReceiptSubagentSchema).optional()
})
export type RunReceipt = z.infer<typeof RunReceiptSchema>

export const HarnessReviewRequestSchema = z.object({
  workspacePath: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional()
})
export type HarnessReviewRequest = z.infer<typeof HarnessReviewRequestSchema>

export const HarnessReviewResultSchema = z.object({
  proposalPath: z.string().min(1),
  relativePath: z.string().min(1),
  receiptCount: z.number().int().min(0),
  summary: z.string()
})
export type HarnessReviewResult = z.infer<typeof HarnessReviewResultSchema>

export const HarnessPreviewApplyRequestSchema = z.object({
  workspacePath: z.string().min(1),
  proposalPath: z.string().min(1).optional()
})
export type HarnessPreviewApplyRequest = z.infer<typeof HarnessPreviewApplyRequestSchema>

export const HarnessPreviewApplyResultSchema = z.object({
  proposalPath: z.string().min(1),
  relativePath: z.string().min(1),
  current: z.string(),
  proposed: z.string(),
  changed: z.boolean()
})
export type HarnessPreviewApplyResult = z.infer<typeof HarnessPreviewApplyResultSchema>

export const HarnessApplyRequestSchema = z.object({
  workspacePath: z.string().min(1),
  proposalPath: z.string().min(1).optional(),
  /** Must be true — accidental applies are rejected. */
  confirm: z.literal(true)
})
export type HarnessApplyRequest = z.infer<typeof HarnessApplyRequestSchema>

export const HarnessApplyResultSchema = z.object({
  applied: z.boolean(),
  proposalPath: z.string().min(1),
  relativePath: z.string().min(1),
  harnessPath: z.string().min(1),
  validationOk: z.boolean(),
  validationOutput: z.string(),
  reverted: z.boolean()
})
export type HarnessApplyResult = z.infer<typeof HarnessApplyResultSchema>

export const ReadRunArtifactRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: RunIdSchema,
  name: RunArtifactNameSchema
})
export type ReadRunArtifactRequest = z.infer<typeof ReadRunArtifactRequestSchema>

export const ReadRunArtifactResultSchema = z.object({
  name: RunArtifactNameSchema,
  exists: z.boolean(),
  content: z.string().nullable()
})
export type ReadRunArtifactResult = z.infer<typeof ReadRunArtifactResultSchema>

/**
 * A gated tool call waiting on the user. The loop is parked on this request, so
 * the renderer must either answer it or cancel the run.
 */
export const ToolApprovalRequestSchema = z.object({
  requestId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  summary: z.string(),
  /** Raw arguments so the card can show exactly what would run. */
  argsPreview: z.string(),
  /** False for approval-exempt tools; true for mutating tools, web_fetch, and MCP. */
  mutating: z.boolean(),
  /** When set, the gated call belongs to a nested agent under this parent tool row. */
  parentToolCallId: z.string().min(1).optional(),
  subagentId: z.string().min(1).optional()
})
export type ToolApprovalRequest = z.infer<typeof ToolApprovalRequestSchema>

export const ToolApprovalDecisionSchema = z.enum(['once', 'session', 'always', 'deny'])
export type ToolApprovalDecision = z.infer<typeof ToolApprovalDecisionSchema>

export const ToolApprovalResponseSchema = z.object({
  requestId: z.string().min(1),
  runId: z.string().min(1),
  decision: ToolApprovalDecisionSchema
})
export type ToolApprovalResponse = z.infer<typeof ToolApprovalResponseSchema>

export const ListPendingToolApprovalsRequestSchema = z.object({
  runId: RunIdSchema
})
export type ListPendingToolApprovalsRequest = z.infer<
  typeof ListPendingToolApprovalsRequestSchema
>

export const AgentQuestionTypeSchema = z.enum(['single', 'multi', 'boolean', 'text'])

export const AgentQuestionItemSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    type: AgentQuestionTypeSchema,
    options: z.array(z.string().min(1)).optional(),
    allowCustom: z.boolean().optional()
  })
  .superRefine((item, ctx) => {
    if (item.type === 'single' || item.type === 'multi') {
      if (!item.options || item.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${item.type} requires at least 2 options`,
          path: ['options']
        })
      }
    }
  })

/**
 * A structured question form waiting on the user. The loop is parked on this
 * request, so the renderer must answer it or cancel the run.
 */
export const AgentQuestionRequestSchema = z.object({
  requestId: z.string().min(1),
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  title: z.string().min(1).optional(),
  questions: z.array(AgentQuestionItemSchema).min(1).max(8),
  /** When set, the question belongs to a nested agent under this parent tool row. */
  parentToolCallId: z.string().min(1).optional(),
  subagentId: z.string().min(1).optional()
})
export type AgentQuestionRequest = z.infer<typeof AgentQuestionRequestSchema>
export type AgentQuestionItem = z.infer<typeof AgentQuestionItemSchema>

export const AgentQuestionAnswerSchema = z.object({
  questionId: z.string().min(1),
  values: z.array(z.string())
})
export type AgentQuestionAnswer = z.infer<typeof AgentQuestionAnswerSchema>

export const AgentQuestionResponseSchema = z.object({
  requestId: z.string().min(1),
  runId: z.string().min(1),
  answers: z.array(AgentQuestionAnswerSchema)
})
export type AgentQuestionResponse = z.infer<typeof AgentQuestionResponseSchema>

export const ListPendingAgentQuestionsRequestSchema = z.object({
  runId: RunIdSchema
})
export type ListPendingAgentQuestionsRequest = z.infer<
  typeof ListPendingAgentQuestionsRequestSchema
>

export const ListRunsRequestSchema = z.object({
  workspacePath: z.string().min(1)
})

export const LoadRunRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: RunIdSchema
})

export const LoadToolResultRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: RunIdSchema,
  toolCallId: z.string().min(1)
})
export type LoadToolResultRequest = z.infer<typeof LoadToolResultRequestSchema>

export const LoadToolResultResultSchema = z.object({
  content: z.string()
})
export type LoadToolResultResult = z.infer<typeof LoadToolResultResultSchema>

export const DeleteRunRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: RunIdSchema
})
export type DeleteRunRequest = z.infer<typeof DeleteRunRequestSchema>

export const RenameRunRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: RunIdSchema,
  goal: z.string().min(1)
})
export type RenameRunRequest = z.infer<typeof RenameRunRequestSchema>

export const ActiveRunSchema = z.object({
  runId: z.string(),
  workspacePath: z.string(),
  invokeId: z.number().int().min(1),
  pendingFollowUps: z
    .array(
      z.object({
        id: z.string().min(1),
        preview: z.string()
      })
    )
    .default([])
})
export type ActiveRun = z.infer<typeof ActiveRunSchema>

export const ActiveRunsResultSchema = z.array(ActiveRunSchema)
export type ActiveRunsResult = z.infer<typeof ActiveRunsResultSchema>

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function fail(error: string, code?: string): IpcResult<never> {
  return code ? { ok: false, error, code } : { ok: false, error }
}

export function contentDisplayText(content: MessageContent): string {
  if (typeof content === 'string') return content
  return content
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim()
}

export function contentImages(content: MessageContent): string[] {
  if (typeof content === 'string') return []
  return content.filter((p) => p.type === 'image_url').map((p) => p.url)
}

export type AttachedFile = Extract<ContentPart, { type: 'file' }>
export type AttachedAudio = Extract<ContentPart, { type: 'audio' }>
export type AttachedNativeFile = Extract<ContentPart, { type: 'file_native' }>

export function contentAudios(content: MessageContent): AttachedAudio[] {
  if (typeof content === 'string') return []
  return content.filter((p): p is AttachedAudio => p.type === 'audio')
}

export function contentNativeFiles(content: MessageContent): AttachedNativeFile[] {
  if (typeof content === 'string') return []
  return content.filter((p): p is AttachedNativeFile => p.type === 'file_native')
}

/** Renderer hands raw bytes to main, which owns the parsers and the caps. */
export const ExtractAttachmentRequestSchema = z.object({
  name: z.string().min(1).max(400),
  mime: z.string().max(200).default(''),
  /** Base64 of the file bytes, capped at `MAX_ATTACHMENT_BYTES` once decoded. */
  data: z.string().min(1).max(MAX_ATTACHMENT_DATA_CHARS)
})
export type ExtractAttachmentRequest = z.infer<typeof ExtractAttachmentRequestSchema>

export const ExtractAttachmentResultSchema = z.object({
  name: z.string(),
  mime: z.string(),
  text: z.string(),
  /** True when the document was longer than `MAX_ATTACHMENT_CHARS`. */
  truncated: z.boolean()
})
export type ExtractAttachmentResult = z.infer<typeof ExtractAttachmentResultSchema>

export const WorkspaceSuggestPathsRequestSchema = z.object({
  workspacePath: z.string().min(1),
  query: z.string().optional(),
  maxResults: z.number().int().min(1).max(100).optional()
})
export type WorkspaceSuggestPathsRequest = z.infer<typeof WorkspaceSuggestPathsRequestSchema>

export const WorkspaceSuggestPathsResultSchema = z.object({
  paths: z.array(z.string()),
  /** Total matches before slicing to maxResults. */
  total: z.number().int().min(0)
})
export type WorkspaceSuggestPathsResult = z.infer<typeof WorkspaceSuggestPathsResultSchema>

export const WorkspaceReadTextRequestSchema = z.object({
  workspacePath: z.string().min(1),
  path: z.string().min(1)
})
export type WorkspaceReadTextRequest = z.infer<typeof WorkspaceReadTextRequestSchema>

export const WorkspaceReadTextResultSchema = z.object({
  name: z.string(),
  mime: z.string(),
  text: z.string().max(MAX_ATTACHMENT_CHARS),
  truncated: z.boolean()
})
export type WorkspaceReadTextResult = z.infer<typeof WorkspaceReadTextResultSchema>

export const WorkspaceListDocsRequestSchema = z.object({
  workspacePath: z.string().min(1),
  query: z.string().optional(),
  maxResults: z.number().int().min(1).max(100).optional()
})
export type WorkspaceListDocsRequest = z.infer<typeof WorkspaceListDocsRequestSchema>

export const WorkspaceListDocsResultSchema = z.object({
  paths: z.array(z.string())
})
export type WorkspaceListDocsResult = z.infer<typeof WorkspaceListDocsResultSchema>

export const WorkspaceListRulesRequestSchema = z.object({
  workspacePath: z.string().min(1)
})
export type WorkspaceListRulesRequest = z.infer<typeof WorkspaceListRulesRequestSchema>

export const WorkspaceListRulesResultSchema = z.object({
  rules: z.array(
    z.object({
      path: z.string(),
      description: z.string().optional(),
      alwaysApply: z.boolean()
    })
  )
})
export type WorkspaceListRulesResult = z.infer<typeof WorkspaceListRulesResultSchema>

export const WorkspaceDiagnosticsRequestSchema = z.object({
  workspacePath: z.string().min(1),
  kind: z.enum(['typecheck', 'lint']).optional()
})
export type WorkspaceDiagnosticsRequest = z.infer<typeof WorkspaceDiagnosticsRequestSchema>

export const WorkspaceDiagnosticsResultSchema = z.object({
  ok: z.boolean(),
  content: z.string(),
  kind: z.enum(['typecheck', 'lint'])
})
export type WorkspaceDiagnosticsResult = z.infer<typeof WorkspaceDiagnosticsResultSchema>

export function contentFiles(content: MessageContent): AttachedFile[] {
  if (typeof content === 'string') return []
  return content.filter((p): p is AttachedFile => p.type === 'file')
}

/** Render an attachment the way the model should read it: named, then quoted. */
export function attachedFileToText(file: AttachedFile): string {
  return `<attachment name="${file.name}" type="${file.mime || 'text/plain'}">\n${file.text}\n</attachment>`
}

/**
 * Collapse text-extracted attachments into plain text parts.
 * Native file / audio parts are left intact for capability-aware assemble.
 */
export function flattenFileParts(content: MessageContent): MessageContent {
  if (typeof content === 'string') return content
  if (!content.some((p) => p.type === 'file')) return content
  const parts: ContentPart[] = content.map((part) =>
    part.type === 'file' ? { type: 'text' as const, text: attachedFileToText(part) } : part
  )
  return parts
}

/** Wire shapes providers may understand beyond text. */
export type ProviderContentPart =
  | Extract<ContentPart, { type: 'text' }>
  | Extract<ContentPart, { type: 'image_url' }>
  | Extract<ContentPart, { type: 'audio' }>
  | Extract<ContentPart, { type: 'file_native' }>

export type ProviderWireCaps = {
  image?: boolean
  audio?: boolean
  fileNative?: boolean
}

/**
 * Provider-facing view of a content array.
 * Text `file` parts are always inlined; audio/native kept only when caps allow.
 */
export function providerContentParts(
  content: ContentPart[],
  caps: ProviderWireCaps = { image: true }
): ProviderContentPart[] {
  const out: ProviderContentPart[] = []
  for (const part of content) {
    if (part.type === 'text') {
      out.push(part)
      continue
    }
    if (part.type === 'file') {
      out.push({ type: 'text', text: attachedFileToText(part) })
      continue
    }
    if (part.type === 'image_url') {
      if (caps.image !== false) out.push(part)
      else out.push({ type: 'text', text: '[image omitted: model does not support vision]' })
      continue
    }
    if (part.type === 'audio') {
      if (caps.audio) out.push(part)
      else out.push({ type: 'text', text: '[audio omitted: model or provider does not support audio input]' })
      continue
    }
    if (part.type === 'file_native') {
      if (caps.fileNative) out.push(part)
      else
        out.push({
          type: 'text',
          text: `[file omitted: native file "${part.name}" not supported on this provider — re-attach for text extraction]`
        })
    }
  }
  return out
}

export function contentToText(content: MessageContent): string {
  if (typeof content === 'string') return content
  const text = contentDisplayText(content)
  const files = contentFiles(content)
  const natives = contentNativeFiles(content)
  const audios = contentAudios(content)
  const imageCount = contentImages(content).length
  const markers: string[] = []
  for (const file of files) markers.push(attachedFileToText(file))
  for (const file of natives) markers.push(`[file:${file.name}]`)
  if (audios.length) markers.push(audios.length === 1 ? '[audio]' : `[${audios.length} audio]`)
  if (imageCount) markers.push(imageCount === 1 ? '[image]' : `[${imageCount} images]`)
  if (!markers.length) return text
  return [text, ...markers].filter(Boolean).join('\n').trim()
}

export function contentHasImage(content: MessageContent): boolean {
  if (typeof content === 'string') return false
  return content.some((p) => p.type === 'image_url')
}

export type ComposerSendExtras = {
  audio?: AttachedAudio[]
  nativeFiles?: AttachedNativeFile[]
}

export function buildUserContent(
  text: string,
  images?: string[],
  files?: AttachedFile[],
  extras?: { audio?: AttachedAudio[]; nativeFiles?: AttachedNativeFile[] }
): MessageContent {
  const trimmed = text.trim()
  const validImages = images?.filter((url) => url) ?? []
  const validFiles = files?.filter((file) => file.name && file.text) ?? []
  const validAudio = extras?.audio?.filter((a) => a.url) ?? []
  const validNative = extras?.nativeFiles?.filter((f) => f.name && f.data) ?? []
  if (!validImages.length && !validFiles.length && !validAudio.length && !validNative.length) {
    return trimmed
  }
  const parts: ContentPart[] = []
  if (trimmed) parts.push({ type: 'text', text: trimmed })
  for (const file of validFiles) {
    parts.push({ type: 'file', name: file.name, mime: file.mime, text: file.text })
  }
  for (const native of validNative) {
    parts.push({
      type: 'file_native',
      name: native.name,
      mime: native.mime,
      data: native.data
    })
  }
  for (const audio of validAudio) {
    parts.push({ type: 'audio', url: audio.url, ...(audio.mime ? { mime: audio.mime } : {}) })
  }
  for (const url of validImages) {
    parts.push({ type: 'image_url', url })
  }
  return parts
}
