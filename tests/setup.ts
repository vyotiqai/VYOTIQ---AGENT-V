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

afterEach(() => {
  resetActiveRunsForTests()
  vi.clearAllMocks()
})
