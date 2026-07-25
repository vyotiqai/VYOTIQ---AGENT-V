import type { ChatMessage } from '../../../shared/ipc'

const OMIT = '[image omitted: model does not support vision]'

/** Replace image parts with a text marker so non-vision models do not reject the request. */
export function stripImagesFromMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') return m
    const hasImage = m.content.some((p) => p.type === 'image_url')
    if (!hasImage) return m
    const text = m.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim()
    return { ...m, content: text ? `${text}\n${OMIT}` : OMIT }
  })
}
