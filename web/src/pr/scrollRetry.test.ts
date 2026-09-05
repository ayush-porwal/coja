import { describe, expect, it } from 'vitest'
import {
  createScrollRetrier,
  type LayoutProbe,
  probesEqual,
  SCROLL_RETRY_DELAYS_MS,
} from './scrollRetry'

interface Task {
  run: () => void
  delay: number
  cancelled: boolean
}

/** Records scheduled tasks so a test can run them one at a time. */
function manualScheduler() {
  const tasks: Task[] = []
  return {
    schedule(run: () => void, delay: number) {
      const task: Task = { run, delay, cancelled: false }
      tasks.push(task)
      return () => {
        task.cancelled = true
      }
    },
    /** Runs the oldest live task; returns false when none are left. */
    flushNext(): boolean {
      const task = tasks.shift()
      if (!task) return false
      if (!task.cancelled) task.run()
      return true
    },
    flushAll() {
      while (this.flushNext()) {
        // keep going until the queue drains
      }
    },
    live: () => tasks.filter((t) => !t.cancelled).map((t) => t.delay),
  }
}

const INITIAL_PROBE: LayoutProbe = { top: 100, scrollHeight: 5000 }

/** `{ initial: undefined }` models a viewer that is already gone; the default is a live layout. */
function harness({ initial }: { initial: LayoutProbe | undefined } = { initial: INITIAL_PROBE }) {
  const scheduler = manualScheduler()
  let layout: LayoutProbe | undefined = initial
  let issues = 0
  const retrier = createScrollRetrier({
    issue: () => {
      issues += 1
    },
    probe: () => layout,
    schedule: scheduler.schedule,
  })
  return {
    scheduler,
    retrier,
    issues: () => issues,
    move(next: LayoutProbe | undefined) {
      layout = next
    },
  }
}

describe('probesEqual', () => {
  it('compares top and total height, treating a missing probe as unequal to any real one', () => {
    expect(probesEqual({ top: 1, scrollHeight: 2 }, { top: 1, scrollHeight: 2 })).toBe(true)
    expect(probesEqual({ top: 1, scrollHeight: 2 }, { top: 1, scrollHeight: 3 })).toBe(false)
    expect(probesEqual({ top: undefined, scrollHeight: 2 }, { top: 1, scrollHeight: 2 })).toBe(
      false,
    )
    expect(probesEqual(undefined, { top: 1, scrollHeight: 2 })).toBe(false)
    expect(probesEqual(undefined, undefined)).toBe(true)
  })
})

describe('createScrollRetrier', () => {
  it('issues once on start and schedules the first check for the next layout', () => {
    const h = harness()
    h.retrier.start()
    expect(h.issues()).toBe(1)
    expect(h.scheduler.live()).toEqual([0])
    expect(h.retrier.isActive()).toBe(true)
    h.retrier.start() // a second start is a no-op
    expect(h.issues()).toBe(1)
  })

  it('walks the fixed delay schedule and stops without re-issuing when nothing moves', () => {
    const h = harness()
    h.retrier.start()
    const seen: number[] = []
    while (h.scheduler.live().length > 0) {
      seen.push(...h.scheduler.live())
      h.scheduler.flushNext()
    }
    expect(seen).toEqual([...SCROLL_RETRY_DELAYS_MS])
    expect(h.issues()).toBe(1)
    expect(h.retrier.isActive()).toBe(false)
  })

  it('re-issues only when the layout moved since the last issue', () => {
    const h = harness()
    h.retrier.start()
    h.scheduler.flushNext() // 0ms: unchanged
    expect(h.issues()).toBe(1)

    h.move({ top: 100, scrollHeight: 52_000 }) // e.g. a healed item grew the total height
    h.scheduler.flushNext() // 150ms
    expect(h.issues()).toBe(2)

    h.scheduler.flushNext() // 400ms: unchanged since the re-issue
    expect(h.issues()).toBe(2)

    h.move({ top: 700, scrollHeight: 52_000 }) // the target itself moved
    h.scheduler.flushNext() // 900ms
    expect(h.issues()).toBe(3)

    h.scheduler.flushAll()
    expect(h.issues()).toBe(3)
    expect(h.retrier.isActive()).toBe(false)
  })

  it('nudge checks immediately without consuming a scheduled step', () => {
    const h = harness()
    h.retrier.start()
    h.retrier.nudge()
    expect(h.scheduler.live()).toEqual([0, 0]) // the first step and the nudge

    h.move({ top: 640, scrollHeight: 5000 })
    h.scheduler.flushNext() // the step: moved → re-issue
    expect(h.issues()).toBe(2)
    h.scheduler.flushNext() // the nudge: unchanged since → nothing
    expect(h.issues()).toBe(2)

    // Every scheduled delay still runs afterwards.
    const remaining = h.scheduler.live()
    expect(remaining).toEqual([150])
    h.scheduler.flushAll()
    expect(h.retrier.isActive()).toBe(false)
  })

  it('a later nudge replaces a pending one', () => {
    const h = harness()
    h.retrier.start()
    h.retrier.nudge()
    h.retrier.nudge()
    expect(h.scheduler.live()).toEqual([0, 0]) // step + one live nudge
  })

  it('cancel stops everything, including pending tasks', () => {
    const h = harness()
    h.retrier.start()
    h.retrier.nudge()
    h.retrier.cancel()
    expect(h.retrier.isActive()).toBe(false)
    expect(h.scheduler.live()).toEqual([])
    h.move({ top: 900, scrollHeight: 9000 })
    h.scheduler.flushAll()
    expect(h.issues()).toBe(1)
  })

  it('gives up when the viewer is gone', () => {
    const h = harness()
    h.retrier.start()
    h.move(undefined)
    h.scheduler.flushNext()
    expect(h.issues()).toBe(1)
    expect(h.retrier.isActive()).toBe(false)
    expect(h.scheduler.live()).toEqual([])
  })

  it('does not schedule anything when the viewer is gone at start', () => {
    const h = harness({ initial: undefined })
    h.retrier.start()
    expect(h.issues()).toBe(1)
    expect(h.retrier.isActive()).toBe(false)
    expect(h.scheduler.live()).toEqual([])
  })

  it('honours a custom delay list', () => {
    const scheduler = manualScheduler()
    const retrier = createScrollRetrier({
      issue: () => {},
      probe: () => ({ top: 0, scrollHeight: 1 }),
      schedule: scheduler.schedule,
      delays: [5, 10],
    })
    retrier.start()
    expect(scheduler.live()).toEqual([5])
    scheduler.flushNext()
    expect(scheduler.live()).toEqual([10])
    scheduler.flushNext()
    expect(scheduler.live()).toEqual([])
    expect(retrier.isActive()).toBe(false)
  })
})
