import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'
import { cn, focusRing } from '../ui'

export const SPLIT_MIN = 20
export const SPLIT_MAX = 80
export const SPLIT_STEP = 2
export const SPLIT_STEP_LARGE = 5

interface SplitDividerProps {
  /** Left column width in percent of the diff pane (clamped to SPLIT_MIN–SPLIT_MAX). */
  leftPct: number
  onChange(leftPct: number): void
}

/**
 * The draggable boundary between the old and new sides of a split diff. Drag,
 * arrow keys, or Home/End — same affordances as the panel splitters. The
 * position lives in the `--coja-split-left` CSS variable on the diff root, so
 * dragging only writes CSS: the library's split grid and this handle both read
 * the variable and move live, with no React re-render until drag end.
 */
export function SplitDivider({ leftPct, onChange }: SplitDividerProps) {
  const handle = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const clamp = (candidate: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, candidate))

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const pane = handle.current?.parentElement
    if (!pane) return
    const rect = pane.getBoundingClientRect()
    const width = rect.width || 1
    event.preventDefault()
    setDragging(true)
    document.body.classList.add('coja-resizing')
    const onMove = (move: PointerEvent) => {
      onChange(clamp(Math.round(((move.clientX - rect.left) / width) * 100)))
    }
    const onUp = () => {
      setDragging(false)
      document.body.classList.remove('coja-resizing')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? SPLIT_STEP_LARGE : SPLIT_STEP
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onChange(clamp(leftPct - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onChange(clamp(leftPct + step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onChange(SPLIT_MIN)
    } else if (event.key === 'End') {
      event.preventDefault()
      onChange(SPLIT_MAX)
    }
  }

  // ARIA attributes via spread: the a11y linter would otherwise insist on an
  // <hr>, which cannot carry tabIndex or the keyboard handling a splitter needs.
  const separatorAria = {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': 'Resize split columns',
    'aria-valuenow': Math.round(leftPct),
    'aria-valuemin': SPLIT_MIN,
    'aria-valuemax': SPLIT_MAX,
  } as const

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the split divider is a custom interactive widget by design
    <div
      ref={handle}
      {...separatorAria}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the divider is focusable so resizing is keyboard-operable
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      style={{ left: 'var(--coja-split-left, 50%)' }}
      className={cn(
        'group absolute inset-y-0 z-10 w-4 -translate-x-1/2 cursor-col-resize',
        focusRing,
        dragging && 'bg-accent/20',
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2',
          dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-accent',
        )}
      />
    </div>
  )
}
