import type { ChatMessage } from '../../../shared/ipc'
import { contentToText } from '../../../shared/ipc'
import { KEEP_LAST_TOOL_RESULTS } from './types'

const MAX_TOOL_CHARS = 12_000
const MAX_SUBAGENT_CHARS = 8_000
const STUB = '[cleared: re-read with tools]'

export type TrimToolResultsOptions = {
  /** When true, also clear/stub subagent results (normally preserved). */
  trimSubagent?: boolean
}

/** Collapse old re-fetchable tool bodies; always head+tail trim oversized results. */
export function trimToolResults(
  messages: ChatMessage[],
  keepLast = KEEP_LAST_TOOL_RESULTS,
  opts: TrimToolResultsOptions = {}
): ChatMessage[] {
  const toolIndexes: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') toolIndexes.push(i)
  }
  const keep = new Set(toolIndexes.slice(-keepLast))
  const trimSubagent = opts.trimSubagent === true

  return messages.map((m, i) => {
    if (m.role !== 'tool') return m
    const isSubagent = m.toolName === 'subagent'
    if (isSubagent && !trimSubagent) return m
    const text = contentToText(m.content)
    if (!keep.has(i) && text && text !== STUB) {
      return { ...m, content: STUB }
    }
    const maxChars = isSubagent ? MAX_SUBAGENT_CHARS : MAX_TOOL_CHARS
    if (text.length > maxChars) {
      const head = Math.floor(maxChars * 0.6)
      const tail = maxChars - head - 40
      return {
        ...m,
        content: `${text.slice(0, head)}\n…[truncated]…\n${text.slice(-tail)}`
      }
    }
    return m
  })
}
