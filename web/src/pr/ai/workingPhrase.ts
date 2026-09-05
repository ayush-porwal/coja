import { useEffect, useState } from 'react'

/**
 * Human, review-flavoured phrases shown while a turn runs. Rotated so a long
 * tool-using answer still feels alive rather than stuck on one word.
 */
export const WORKING_PHRASES = [
  'Reading the changes…',
  'Thinking it through…',
  'Digging into the diff…',
  'Weighing the risks…',
  'Cross-checking the code…',
  'Putting the answer together…',
] as const

export const WORKING_PHRASE_MS = 2800

/** Cycles through the working phrases while `active`; resets to the first when idle. */
export function useWorkingPhrase(active: boolean): string {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!active) {
      setIndex(0)
      return
    }
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % WORKING_PHRASES.length)
    }, WORKING_PHRASE_MS)
    return () => clearInterval(timer)
  }, [active])
  return WORKING_PHRASES[index] ?? WORKING_PHRASES[0]
}
