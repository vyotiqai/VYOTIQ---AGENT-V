import { existsSync } from 'node:fs'

import { join } from 'node:path'

import { Worker } from 'node:worker_threads'



const POOL_SIZE = 2



type CountItem = { text: string; encoding: 'o200k_base' | 'cl100k_base' }



type Pending = {

  resolve: (counts: number[]) => void

  reject: (err: Error) => void

}



type WorkerMsg = { id: number; counts?: number[]; error?: string }



type WorkerSlot = {

  worker: Worker

  pending: Map<number, Pending>

}



let slots: WorkerSlot[] | null = null

/** Only set when the worker script is missing or pool create fails — not on a single worker crash. */

let poolCreateFailed = false

let nextId = 1

let rr = 0



function workerScriptPath(): string {

  return join(__dirname, 'tokenizer.worker.js')

}



function rejectAll(pending: Map<number, Pending>, err: Error): void {

  for (const [id, slot] of pending) {

    pending.delete(id)

    slot.reject(err)

  }

}



function attachWorker(slot: WorkerSlot): void {

  slot.worker.on('message', (msg: WorkerMsg) => {

    const pending = slot.pending.get(msg.id)

    if (!pending) return

    slot.pending.delete(msg.id)

    if (msg.error) {

      pending.reject(new Error(msg.error))

      return

    }

    pending.resolve(msg.counts ?? [])

  })

  const failWorker = (err: Error): void => {

    rejectAll(slot.pending, err)

    void slot.worker.terminate().catch(() => undefined)

    if (!slots) return

    const idx = slots.indexOf(slot)

    if (idx < 0) return

    const replacement = tryCreateWorker()

    if (replacement) {

      slots[idx] = replacement

    } else {

      slots.splice(idx, 1)

      if (slots.length === 0) {

        slots = null

      }

    }

  }

  slot.worker.on('error', (err) => {

    failWorker(err instanceof Error ? err : new Error(String(err)))

  })

  slot.worker.on('exit', (code) => {

    if (slot.pending.size === 0) return

    failWorker(new Error(`Tokenizer worker exited with code ${code}`))

  })

}



function tryCreateWorker(): WorkerSlot | null {

  const script = workerScriptPath()

  if (!existsSync(script)) return null

  try {

    const worker = new Worker(script)

    const slot: WorkerSlot = { worker, pending: new Map() }

    attachWorker(slot)

    return slot

  } catch {

    return null

  }

}



function tryCreatePool(): WorkerSlot[] | null {

  if (poolCreateFailed) return null

  const script = workerScriptPath()

  if (!existsSync(script)) {

    poolCreateFailed = true

    return null

  }

  const list: WorkerSlot[] = []

  for (let i = 0; i < POOL_SIZE; i++) {

    const slot = tryCreateWorker()

    if (!slot) {

      for (const existing of list) {

        rejectAll(existing.pending, new Error('Tokenizer pool create failed'))

        void existing.worker.terminate().catch(() => undefined)

      }

      poolCreateFailed = true

      return null

    }

    list.push(slot)

  }

  return list

}



/**

 * Encode a batch off the main thread.

 * Returns `null` when the worker bundle is missing (vitest / pre-build) so

 * callers can fall back to sync BPE on the main thread.

 */

export async function encodeCountsInWorker(items: CountItem[]): Promise<number[] | null> {

  if (items.length === 0) return []

  if (!slots || slots.length === 0) slots = tryCreatePool()

  if (!slots || slots.length === 0) return null



  const id = nextId++

  const slot = slots[rr++ % slots.length]!

  return new Promise<number[]>((resolve, reject) => {

    slot.pending.set(id, { resolve, reject })

    try {

      slot.worker.postMessage({ id, items })

    } catch (err) {

      slot.pending.delete(id)

      reject(err instanceof Error ? err : new Error(String(err)))

    }

  })

}



/** Test helper — terminate workers and allow re-init. */

export function resetTokenizerPoolForTests(): void {

  if (slots) {

    for (const slot of slots) {

      rejectAll(slot.pending, new Error('Tokenizer pool reset'))

      void slot.worker.terminate().catch(() => undefined)

    }

  }

  slots = null

  poolCreateFailed = false

  nextId = 1

  rr = 0

}

/** Terminate workers on app quit (best-effort). */
export function shutdownTokenizerPool(): void {
  resetTokenizerPoolForTests()
}

