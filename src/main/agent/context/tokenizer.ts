import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base'
import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base'
import type { ModelInfo } from '../../../shared/ipc/schemas/providers'

export type EncodingName = 'o200k_base' | 'cl100k_base'

/**
 * Running a real BPE over a megabyte of tool output costs more than the
 * accuracy is worth, so anything past this falls back to the chars/4 heuristic.
 */
const LARGE_TEXT_CHARS = 100_000
const HEURISTIC_CHARS_PER_TOKEN = 4

/**
 * Assembly re-counts the whole history on every step, so the same strings are
 * tokenized over and over. Keys are references to strings that already exist in
 * the message array, so this holds pointers rather than copies.
 */
const CACHE_LIMIT = 4000
const cache = new Map<string, number>()

/** Only OpenAI models predating gpt-4o still use cl100k. */
export function encodingForModel(model?: ModelInfo): EncodingName {
  const id = model?.id ?? ''
  if (/^(gpt-4(?!o|\.|-?1)|gpt-3\.5|text-davinci)/i.test(id)) return 'cl100k_base'
  return 'o200k_base'
}

function encodeWith(encoding: EncodingName, text: string): number {
  return encoding === 'cl100k_base' ? encodeCl100k(text).length : encodeO200k(text).length
}

export function countTextTokens(text: string, encoding: EncodingName = 'o200k_base'): number {
  if (!text) return 0
  if (text.length > LARGE_TEXT_CHARS) {
    return Math.ceil(text.length / HEURISTIC_CHARS_PER_TOKEN)
  }

  const key = encoding === 'o200k_base' ? text : `${encoding}\u0000${text}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  let count: number
  try {
    count = encodeWith(encoding, text)
  } catch {
    // A malformed lone surrogate can throw; the heuristic is better than crashing.
    count = Math.ceil(text.length / HEURISTIC_CHARS_PER_TOKEN)
  }

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, count)
  return count
}

/** Exposed for tests; the cache is otherwise process-lifetime. */
export function resetTokenizerCache(): void {
  cache.clear()
}
