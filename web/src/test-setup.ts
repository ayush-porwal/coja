import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom has no matchMedia; the theme system reads prefers-color-scheme through it.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// Testing Library only auto-registers cleanup when `afterEach` is a global; we import it instead.
afterEach(() => {
  cleanup()
  // Tests stub `fetch` (and occasionally `window.confirm`); never let one test leak into the next.
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
