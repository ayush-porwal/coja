import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkingPhrase, WORKING_PHRASES } from './workingPhrase'

describe('useWorkingPhrase', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts at the first phrase and rotates through all of them, then wraps', () => {
    const { result } = renderHook(() => useWorkingPhrase(true))
    expect(result.current).toBe(WORKING_PHRASES[0])
    for (let step = 1; step <= WORKING_PHRASES.length; step += 1) {
      act(() => {
        vi.advanceTimersByTime(2800)
      })
      expect(result.current).toBe(WORKING_PHRASES[step % WORKING_PHRASES.length])
    }
  })

  it('resets to the first phrase when the turn ends', () => {
    const { result, rerender } = renderHook(({ active }) => useWorkingPhrase(active), {
      initialProps: { active: true },
    })
    act(() => {
      vi.advanceTimersByTime(2800 * 2)
    })
    expect(result.current).toBe(WORKING_PHRASES[2])
    rerender({ active: false })
    expect(result.current).toBe(WORKING_PHRASES[0])
  })
})
