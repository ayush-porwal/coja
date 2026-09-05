/**
 * Re-aims a programmatic CodeView scroll while the virtual layout settles.
 *
 * `CodeView.scrollTo` resolves its destination from the *current* virtual
 * layout and forgets the target as soon as the scroll position matches. The
 * layout keeps moving for a while after a jump, though: the target item mounts,
 * deferred highlights land, annotation heights get measured, and the screen may
 * relayout to heal a zero-height item (see `diffLayout.ts`). This small state
 * machine re-issues the same scroll whenever the layout has moved since the
 * last issue, at a fixed set of delays, and stops on user intent.
 *
 * Pure: time and the viewer come in through `schedule`, `probe` and `issue`.
 */

/** The parts of the virtual layout a scroll destination depends on. */
export interface LayoutProbe {
  /** Layout top of the target item (undefined until CodeView knows the item). */
  top: number | undefined
  /** Total virtual height; it bounds how far the viewer can scroll. */
  scrollHeight: number
}

export function probesEqual(a: LayoutProbe | undefined, b: LayoutProbe | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.top === b.top && a.scrollHeight === b.scrollHeight
}

export interface ScrollRetrierOptions {
  /** Performs the scroll (idempotent: same target every time). */
  issue(): void
  /** Reads the layout; `undefined` when the viewer is gone. */
  probe(): LayoutProbe | undefined
  /** Runs `run` after `delayMs` (0 = "after the next layout"); returns a cancel function. */
  schedule(run: () => void, delayMs: number): () => void
  /** Check delays, in ms since the previous check. */
  delays?: readonly number[]
}

export interface ScrollRetrier {
  /** Issues the scroll and starts checking. No-op after the first call. */
  start(): void
  /** Checks once more, off the fixed schedule (e.g. the target item just mounted). */
  nudge(): void
  /** Stops checking; nothing is issued afterwards. */
  cancel(): void
  isActive(): boolean
}

/**
 * Two frames for CodeView's queued render pass, then the delays that cover a
 * deferred highlight, a coalesced relayout, and a slow grammar download.
 */
export const SCROLL_RETRY_DELAYS_MS: readonly number[] = [0, 150, 400, 900, 1600]

export function createScrollRetrier({
  issue,
  probe,
  schedule,
  delays = SCROLL_RETRY_DELAYS_MS,
}: ScrollRetrierOptions): ScrollRetrier {
  let state: 'idle' | 'active' | 'done' = 'idle'
  let last: LayoutProbe | undefined
  let step = 0
  let cancelStep: (() => void) | undefined
  let cancelNudge: (() => void) | undefined

  const finish = () => {
    state = 'done'
    cancelStep?.()
    cancelNudge?.()
    cancelStep = undefined
    cancelNudge = undefined
  }

  /** Re-issues the scroll if the layout moved since the last issue. */
  const evaluate = () => {
    if (state !== 'active') return
    const next = probe()
    if (next === undefined) {
      finish()
      return
    }
    if (probesEqual(last, next)) return
    last = next
    issue()
  }

  const scheduleStep = () => {
    if (state !== 'active') return
    const delay = delays[step]
    if (delay === undefined) {
      finish()
      return
    }
    step += 1
    cancelStep = schedule(() => {
      cancelStep = undefined
      evaluate()
      scheduleStep()
    }, delay)
  }

  return {
    start() {
      if (state !== 'idle') return
      state = 'active'
      issue()
      last = probe()
      if (last === undefined) {
        finish()
        return
      }
      scheduleStep()
    },
    nudge() {
      if (state !== 'active') return
      cancelNudge?.()
      cancelNudge = schedule(() => {
        cancelNudge = undefined
        evaluate()
      }, 0)
    },
    cancel: finish,
    isActive: () => state === 'active',
  }
}

/**
 * Browser scheduler for `createScrollRetrier`: a zero delay waits two animation
 * frames (CodeView renders in the first, the browser lays it out by the second);
 * anything else is a timeout.
 */
export function scheduleAfterLayout(run: () => void, delayMs: number): () => void {
  if (delayMs <= 0) {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(run)
    })
    return () => cancelAnimationFrame(frame)
  }
  const timer = setTimeout(run, delayMs)
  return () => clearTimeout(timer)
}
