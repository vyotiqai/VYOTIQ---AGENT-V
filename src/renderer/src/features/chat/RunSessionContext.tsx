import { createContext, useContext } from 'react'

/** Active chat run identity for tool cards that load run-dir artifacts. */
export type RunSessionValue = {
  workspacePath: string | null
  runId: string | null
}

const RunSessionContext = createContext<RunSessionValue>({
  workspacePath: null,
  runId: null
})

export const RunSessionProvider = RunSessionContext.Provider

export function useRunSession(): RunSessionValue {
  return useContext(RunSessionContext)
}
