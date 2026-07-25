import type { ChatMessage } from '../../../shared/ipc'
import { contentToText } from '../../../shared/ipc'
import { KEEP_LAST_TOOL_RESULTS } from './types'

const MAX_TOOL_CHARS = 12_000
const STUB = '[cleared: re-read with tools]'

/** Collapse old re-fetchable tool bodies; always head+tail trim oversized results. */
export function trimToolResults(
  messages: ChatMessage[],
  keepLast = KEEP_LAST_TOOL_RESULTS
): ChatMessage[] {
  const toolIndexes: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') toolIndexes.push(i)
  }
  const keep = new Set(toolIndexes.slice(-keepLast))

  return messages.map((m, i) => {
    if (m.role !== 'tool') return m
    const text = contentToText(m.content)
    if (!keep.has(i) && text && text !== STUB) {
      return { ...m, content: STUB }
    }
    if (text.length > MAX_TOOL_CHARS) {
      const head = Math.floor(MAX_TOOL_CHARS * 0.6)
      const tail = MAX_TOOL_CHARS - head - 40
      return {
        ...m,
        content: `${text.slice(0, head)}\n…[truncated]…\n${text.slice(-tail)}`
      }
    }
    return m
  })
}
