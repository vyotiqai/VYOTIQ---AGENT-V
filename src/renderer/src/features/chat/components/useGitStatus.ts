import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatus } from '@shared/ipc'

export type GitStatusState = {
  status: GitStatus | null
  /** True until the first answer arrives, so the bar can stay out of the way. */
  loading: boolean
  refresh: () => void
}

/**
 * Track the workspace's git state.
 *
 * Refreshed on demand rather than polled: shelling out to git on a timer costs
 * real work on a large repository, and the interesting moments (a turn ending,
 * a commit landing) are all things the caller already knows about. `enabled`
 * lets a caller skip the work entirely on screens with nowhere to show it.
 */
export function useGitStatus(
  workspacePath: string | null,
  revision: number,
  enabled = true
): GitStatusState {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(Boolean(workspacePath) && enabled)
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

    return () => {
      cancelled = true
    }
  }, [workspacePath, revision, manualRevision, enabled])

  const refresh = useCallback(() => setManualRevision((value) => value + 1), [])

  return { status, loading, refresh }
}
