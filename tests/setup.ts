import { afterEach, vi } from 'vitest'
import { resetActiveRunsForTests } from '@main/agent/runRegistry'

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    })
  })
}

// `globals: false` means Testing Library never registers its own auto-cleanup, so
// rendered trees would stay mounted for the rest of the file and their timers can
// outlive the environment.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)
}

afterEach(() => {
  resetActiveRunsForTests()
  vi.clearAllMocks()
})
