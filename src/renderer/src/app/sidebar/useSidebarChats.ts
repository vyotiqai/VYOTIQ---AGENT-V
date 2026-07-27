import { useMemo } from 'react'
import type { RunSummary } from '@shared/ipc'
import { groupRunsByRecency } from '@renderer/lib/utils/groupRunsByRecency'

export function useSidebarChats(runs: RunSummary[], sessionQuery: string) {
  const filteredRuns = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase()
    if (!q) return runs
    return runs.filter((r) => {
      const title = (r.goal ?? r.runId).toLowerCase()
      return title.includes(q)
    })
  }, [runs, sessionQuery])

  const groupedRuns = useMemo(() => {
    if (sessionQuery.trim()) {
      return filteredRuns.length
        ? [{ id: 'today' as const, label: 'Results', runs: filteredRuns }]
        : []
    }
    return groupRunsByRecency(filteredRuns)
  }, [filteredRuns, sessionQuery])

  const runningCount = useMemo(
    () => runs.filter((r) => r.status === 'running').length,
    [runs]
  )

  return { filteredRuns, groupedRuns, runningCount }
}
