import { appendFile } from 'fs/promises'
import { basename, join } from 'path'
import { logger } from '../../shared/logger'

/** Per-run-dir serialized message append chain — ordered, non-blocking. */
const appendChains = new Map<string, Promise<void>>()

export function enqueueMessageAppend(dir: string, line: string): Promise<void> {
  const path = join(dir, 'messages.jsonl')
  const prev = appendChains.get(dir) ?? Promise.resolve()
  const next = prev
    .then(() => appendFile(path, line, 'utf8'))
    .catch((err) => {
      logger.warn('Failed to append messages.jsonl', {
        scope: 'state',
        correlationId: basename(dir),
        err
      })
    })
    .finally(() => {
      if (appendChains.get(dir) === next) appendChains.delete(dir)
    })
  appendChains.set(dir, next)
  return next
}

export async function flushMessageAppends(dir?: string): Promise<void> {
  if (dir) {
    await appendChains.get(dir)
    return
  }
  await Promise.all([...appendChains.values()])
}

/** @internal */
export function messageAppendChainSizeForTests(): number {
  return appendChains.size
}

export function resetMessageAppendQueueForTests(): void {
  appendChains.clear()
}
