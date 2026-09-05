import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Testing Library only auto-registers cleanup when `afterEach` is a global; we import it instead.
afterEach(() => {
  cleanup()
  // Tests stub `fetch` (and occasionally `window.confirm`); never let one test leak into the next.
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
