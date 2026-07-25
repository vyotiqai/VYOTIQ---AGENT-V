import { useCallback, useState } from 'react'

/** Persist a boolean in localStorage; falls back to `initial` when missing/invalid. */
export function usePersistedBoolean(
  key: string,
  initial = false
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === '1' || raw === 'true') return true
      if (raw === '0' || raw === 'false') return false
    } catch {
      /* private mode / blocked storage */
    }
    return initial
  })

  const setPersisted = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        try {
          localStorage.setItem(key, resolved ? '1' : '0')
        } catch {
          /* ignore */
        }
        return resolved
      })
    },
    [key]
  )

  return [value, setPersisted]
}
