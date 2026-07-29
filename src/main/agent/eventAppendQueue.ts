import { appendFile } from 'fs/promises'
import { basename, join } from 'path'
import { logger } from '../../shared/logger'

/** Per-run-dir serialized append chain — ordered, non-blocking, single-writer safe. */
const appendChains = new Map<string, Promise<void>>()

export function enqueueEventAppend(dir: string, event: unknown): void {
  const line = `${JSON.stringify({ at: new Date().toISOString(), event })}\n`
  const path = join(dir, 'events.jsonl')
  const prev = appendChains.get(dir) ?? Promise.resolve()
  const next = prev
    .then(() => appendFile(path, line, 'utf8'))
    .catch((err) => {
      logger.warn('Failed to append events.jsonl', {
        scope: 'state',
        correlationId: basename(dir),
        err
      })
    })
    .finally(() => {
      // Drop settled chains so long sessions do not retain every Promise forever.
      if (appendChains.get(dir) === next) appendChains.delete(dir)
    })
  appendChains.set(dir, next)
}

export async function flushEventAppends(dir?: string): Promise<void> {
  if (dir) {
    await appendChains.get(dir)
    return
  }
  await Promise.all([...appendChains.values()])
}

/** @internal Test helper — how many run dirs still have a pending chain. */
export function appendChainSizeForTests(): number {
  return appendChains.size
}

export function resetEventAppendQueueForTests(): void {
  appendChains.clear()
}
