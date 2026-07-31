import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatus } from '@shared/ipc'

export type GitStatusState = {
  status: GitStatus | null
  /** True until the first answer arrives, so the bar can stay out of the way. */
  loading: boolean
  refresh: () => void
}

/** Keep git chrome off the open critical path (pty/runs/models first). */
const STARTUP_DEFER_MS = 2_500

/**
 * Track the workspace's git state.
 *
 * Refreshed on demand rather than polled: shelling out to git on a timer costs
 * real work on a large repository, and the interesting moments (a turn ending,
 * a commit landing) are all things the caller already knows about. `enabled`
 * lets a caller skip the work entirely on screens with nowhere to show it.
 *
 * First fetch after enable waits past first paint + idle so it does not contend
 * with pty/runs startup IPC.
 */
export function useGitStatus(
  workspacePath: string | null,
  revision: number,
  enabled = true
): GitStatusState {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [manualRevision, setManualRevision] = useState(0)
  const requestRef = useRef(0)

  useEffect(() => {
    if (!workspacePath || !enabled) {
      setStatus(null)
      setLoading(false)
      return undefined
    }

    const request = ++requestRef.current
    let cancelled = false
    let idleId: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const start = (): void => {
      if (cancelled || request !== requestRef.current) return
      setLoading(true)
      void window.vyotiq
        .gitStatus(workspacePath)
        .then((result) => {
          if (cancelled || request !== requestRef.current) return
          setStatus(result.ok ? result.data : null)
        })
        .catch(() => {
          if (!cancelled) setStatus(null)
        })
        .finally(() => {
          if (!cancelled && request === requestRef.current) setLoading(false)
        })
    }

    const scheduleIdle = (): void => {
      if (cancelled || request !== requestRef.current) return
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        idleId = window.requestIdleCallback(start, { timeout: 2_000 })
      } else {
        start()
      }
    }

    // Manual refresh / revision bumps should not wait for startup deferral.
    const deferStartup = manualRevision === 0 && revision === 0
    if (deferStartup) {
      setLoading(false)
      timer = setTimeout(scheduleIdle, STARTUP_DEFER_MS)
    } else {
      start()
    }

    return () => {
      cancelled = true
      if (idleId != null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timer != null) clearTimeout(timer)
    }
  }, [workspacePath, revision, manualRevision, enabled])

  const refresh = useCallback(() => setManualRevision((value) => value + 1), [])

  return { status, loading, refresh }
}
