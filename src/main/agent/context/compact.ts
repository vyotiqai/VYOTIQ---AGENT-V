import type { ChatMessage, ModelInfo } from '../../../shared/ipc'
import { contentToText } from '../../../shared/ipc'
import { logger } from '../../../shared/logger'
import type { LlmProvider } from '../providers/types'
import {
  parseCompactionJson,
  toCompactionJsonSchema,
  type CompactionData
} from '../schemas/compaction'
import { collectStructuredResponse } from '../schemas/structured'
import { estimateMessagesTokens, estimateTextTokens } from './estimate'
import { KEEP_RECENT_TURNS, type CompactionRecord } from './types'

const COMPACTION_PROMPT = `Summarize this coding-agent session for future context. Be concise and factual. Do not invent files or decisions.`

const COMPACTION_FREEFORM_PROMPT = `Summarize this coding-agent session for future context. Use exactly these sections:

## Session Intent
## Files Touched
## Key Decisions
## Constraints
## Open Bugs/Blockers
## Next Steps

Be concise and factual. Do not invent files or decisions.`

async function streamFreeformSummary(input: {
  provider: LlmProvider
  model: string
  apiKey?: string | null
  baseUrl?: string
  signal: AbortSignal
  historyText: string
}): Promise<string> {
  let summary = ''
  for await (const chunk of input.provider.streamChat({
    model: input.model,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    signal: input.signal,
    tools: [],
    system: COMPACTION_FREEFORM_PROMPT,
    messages: [{ role: 'user', content: input.historyText }]
  })) {
    if (input.signal.aborted) return ''
    if (chunk.type === 'text' && chunk.text) summary += chunk.text
    if (chunk.type === 'error') {
      logger.warn('Compaction freeform stream error', {
        scope: 'agent',
        code: 'COMPACTION_STREAM'
      })
      return ''
    }
  }
  return summary.trim()
}

export async function compactMessages(input: {
  provider: LlmProvider
  model: string
  apiKey?: string | null
  baseUrl?: string
  signal: AbortSignal
  messages: ChatMessage[]
  supportsStructuredOutput?: boolean
  contextWindow?: number
}): Promise<CompactionRecord | null> {
  if (input.signal.aborted) return null

  const tokenCap = Math.max(
    4000,
    Math.floor((input.contextWindow ?? 128_000) * 0.25)
  )
  const charCap = tokenCap * 4

  const historyText = input.messages
    .map((m) => {
      const body = contentToText(m.content)
      const tools = m.toolCalls?.map((t) => `${t.name}(${t.arguments})`).join(', ')
      return `${m.role}${tools ? ` tools=${tools}` : ''}: ${body}`
    })
    .join('\n\n')
    .slice(0, charCap)

  if (!historyText.trim()) return null

  let summary = ''
  const useStructured = input.supportsStructuredOutput !== false

  if (useStructured) {
    try {
      const result = await collectStructuredResponse<CompactionData>(
        input.provider,
        {
          model: input.model,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          signal: input.signal,
          tools: [],
          system: COMPACTION_PROMPT,
          messages: [{ role: 'user', content: historyText }],
          responseFormat: {
            type: 'json_schema',
            name: 'compaction_summary',
            schema: toCompactionJsonSchema(),
            strict: true
          }
        },
        (raw) => {
          const parsed = parseCompactionJson(raw)
          if (parsed.structured) return { ok: true, data: parsed.structured }
          return { ok: false, error: 'invalid compaction schema' }
        }
      )
      const parsed = parseCompactionJson(result.rawText)
      if (result.ok || parsed.markdown) {
        summary = parsed.markdown
      }
    } catch (err) {
      logger.warn('Structured compaction failed, falling back to freeform', {
        scope: 'agent',
        code: 'COMPACTION',
        err
      })
    }
  }

  if (!summary) {
    if (input.signal.aborted) return null
    summary = await streamFreeformSummary({
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      signal: input.signal,
      historyText
    })
  }

  if (!summary) {
    logger.warn('Compaction produced no summary despite eligible history', {
      scope: 'agent',
      code: 'COMPACTION',
      messageCount: input.messages.length
    })
    return null
  }
  return {
    summary,
    createdAt: new Date().toISOString(),
    tokenEstimate: estimateTextTokens(summary)
  }
}

/** Keep the last ~N user/assistant turns (tool pairs included). */
export function preserveRecentMessages(
  messages: ChatMessage[],
  keepTurns = KEEP_RECENT_TURNS,
  historyBudgetTokens?: number,
  model?: ModelInfo
): ChatMessage[] {
  let userTurns = 0
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userTurns++
      if (userTurns >= keepTurns) {
        start = i
        break
      }
    }
  }

  if (userTurns < keepTurns) {
    if (!historyBudgetTokens || !model) return messages
    if (estimateMessagesTokens(messages, model) <= historyBudgetTokens) return messages
    start = Math.min(start + 2, messages.length - 1)
  }

  let kept = messages.slice(start)
  while (kept.length > 1 && kept[0].role === 'tool') {
    kept = kept.slice(1)
  }

  if (historyBudgetTokens && model) {
    while (
      kept.length > 2 &&
      estimateMessagesTokens(kept, model) > historyBudgetTokens
    ) {
      const dropIdx = kept.findIndex((m) => m.role === 'user')
      if (dropIdx < 0) break
      const nextUser = kept.findIndex((m, idx) => idx > dropIdx && m.role === 'user')
      const end = nextUser >= 0 ? nextUser : kept.length
      kept = kept.slice(end)
      while (kept.length > 1 && kept[0].role === 'tool') {
        kept = kept.slice(1)
      }
    }
  }

  return kept
}
