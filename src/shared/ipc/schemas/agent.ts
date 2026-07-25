import { z } from 'zod'

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const MAX_IMAGE_DATA_URL_CHARS = Math.ceil(MAX_IMAGE_BYTES * (4 / 3)) + 128

export const ContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image_url'),
    url: z.string().min(1).max(MAX_IMAGE_DATA_URL_CHARS)
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
  workspacePath: z.string().optional()
})
export type RunStatus = z.infer<typeof RunStatusSchema>

export function IpcResultSchema<T extends z.ZodTypeAny>(data: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: z.string() })
  ])
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

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
    type: z.literal('step_budget'),
    ...eventBase,
    step: z.number().int().min(1),
    maxSteps: z.number().int().min(1),
    ratio: z.number().min(0).max(1)
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
    layers: z.object({
      system: z.number().int().min(0),
      history: z.number().int().min(0),
      tools: z.number().int().min(0),
      buffer: z.number().int().min(0)
    })
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
  runId: z.string()
})
export type LoadRunEventsRequest = z.infer<typeof LoadRunEventsRequestSchema>

export const ChatStartRequestSchema = z
  .object({
    messages: z.array(ChatMessageSchema).optional(),
    newMessages: z.array(ChatMessageSchema).optional(),
    incremental: z.boolean().optional(),
    workspacePath: z.string().min(1),
    runId: z.string().optional()
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
  runId: z.string()
})

export const ListRunsRequestSchema = z.object({
  workspacePath: z.string().min(1)
})

export const LoadRunRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: z.string()
})

export const LoadToolResultRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: z.string(),
  toolCallId: z.string()
})
export type LoadToolResultRequest = z.infer<typeof LoadToolResultRequestSchema>

export const LoadToolResultResultSchema = z.object({
  content: z.string()
})
export type LoadToolResultResult = z.infer<typeof LoadToolResultResultSchema>

export const DeleteRunRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: z.string()
})
export type DeleteRunRequest = z.infer<typeof DeleteRunRequestSchema>

export const RenameRunRequestSchema = z.object({
  workspacePath: z.string().min(1),
  runId: z.string(),
  goal: z.string().min(1)
})
export type RenameRunRequest = z.infer<typeof RenameRunRequestSchema>

export const ActiveRunSchema = z.object({
  runId: z.string(),
  workspacePath: z.string()
})
export type ActiveRun = z.infer<typeof ActiveRunSchema>

export const ActiveRunsResultSchema = z.array(ActiveRunSchema)
export type ActiveRunsResult = z.infer<typeof ActiveRunsResultSchema>

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function fail(error: string): IpcResult<never> {
  return { ok: false, error }
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

export function contentToText(content: MessageContent): string {
  if (typeof content === 'string') return content
  const text = contentDisplayText(content)
  const imageCount = contentImages(content).length
  if (!imageCount) return text
  const marker = imageCount === 1 ? '[image]' : `[${imageCount} images]`
  return [text, marker].filter(Boolean).join('\n').trim()
}

export function contentHasImage(content: MessageContent): boolean {
  if (typeof content === 'string') return false
  return content.some((p) => p.type === 'image_url')
}

export function buildUserContent(text: string, images?: string[]): MessageContent {
  const trimmed = text.trim()
  const validImages = images?.filter((url) => url) ?? []
  if (!validImages.length) return trimmed
  const parts: ContentPart[] = []
  if (trimmed) parts.push({ type: 'text', text: trimmed })
  for (const url of validImages) {
    parts.push({ type: 'image_url', url })
  }
  return parts
}
