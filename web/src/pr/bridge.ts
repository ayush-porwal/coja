/**
 * The select→attach / cite→navigate bridge between the diff viewer and the AI
 * panel (design.md §4). A tiny typed event bus with no dependencies:
 *
 * - "Ask AI" on a selection → `attachSelection(chip)` → the AI composer
 *   listens with `onAttachSelection`.
 * - A `file:line` citation in agent output → `scrollToLine(target)` → the diff
 *   viewer listens with `onScrollToLine`.
 */
import type { ContextChip, DiffSide } from '@coja/shared/api'

export interface ScrollToLineTarget {
  path: string
  line: number
  side?: DiffSide
}

type Listener<T> = (payload: T) => void
type Unsubscribe = () => void

export interface Bridge {
  attachSelection(chip: ContextChip): void
  onAttachSelection(cb: Listener<ContextChip>): Unsubscribe
  scrollToLine(target: ScrollToLineTarget): void
  onScrollToLine(cb: Listener<ScrollToLineTarget>): Unsubscribe
}

function createEmitter<T>() {
  const listeners = new Set<Listener<T>>()
  return {
    emit(payload: T) {
      // Copy so a listener unsubscribing during emit does not skip its siblings.
      for (const listener of [...listeners]) listener(payload)
    },
    on(cb: Listener<T>): Unsubscribe {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

/** Factory, so tests (and any future multi-PR layout) can create isolated buses. */
export function createBridge(): Bridge {
  const attach = createEmitter<ContextChip>()
  const scroll = createEmitter<ScrollToLineTarget>()
  return {
    attachSelection: (chip) => attach.emit(chip),
    onAttachSelection: (cb) => attach.on(cb),
    scrollToLine: (target) => scroll.emit(target),
    onScrollToLine: (cb) => scroll.on(cb),
  }
}

/** The app-wide bridge used by the review screen and the AI panel. */
export const bridge: Bridge = createBridge()
