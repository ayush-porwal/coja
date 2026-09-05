import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react'
import { cn, focusRing } from '../ui'

/** Keyboard resize steps, matching a splitter's muscle memory. */
export const PANEL_RESIZE_STEP = 24
export const PANEL_RESIZE_STEP_LARGE = 64

interface PanelResizeHandleProps {
  /** The side the resizable panel sits on, relative to the drag. */
  side: 'left' | 'right'
  /** Current panel width in px — mirrored to AT and used for keyboard steps. */
  width: number
  onResize(width: number): void
  label: string
  min: number
  max: number
}

/**
 * The draggable boundary between the diff and a side panel (VS Code-style):
 * drag to resize, arrow keys when focused, double-click to reset. The diff
 * area reflows live because it is `flex-1` around the panel's width.
 */
export function PanelResizeHandle({
  side,
  width,
  onResize,
  label,
  min,
  max,
}: PanelResizeHandleProps) {
  const handle = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const clamp = (candidate: number) => Math.min(max, Math.max(min, candidate))

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const row = handle.current?.parentElement
    if (!row) return
    const rowRect = row.getBoundingClientRect()
    event.preventDefault()
    setDragging(true)
    document.body.classList.add('coja-resizing')
    const onMove = (move: PointerEvent) => {
      onResize(clamp(side === 'left' ? move.clientX - rowRect.left : rowRect.right - move.clientX))
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
    const grow = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
    const shrink = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
    const step = event.shiftKey ? PANEL_RESIZE_STEP_LARGE : PANEL_RESIZE_STEP
    if (event.key === grow) {
      event.preventDefault()
      onResize(clamp(width + step))
    } else if (event.key === shrink) {
      event.preventDefault()
      onResize(clamp(width - step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      onResize(min)
    } else if (event.key === 'End') {
      event.preventDefault()
      onResize(max)
    }
  }

  // ARIA attributes via spread: the a11y linter would otherwise insist on an
  // <hr>, which cannot carry tabIndex or the keyboard handling a splitter needs.
  const separatorAria = {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': label,
    'aria-valuenow': Math.round(width),
    'aria-valuemin': min,
    'aria-valuemax': max,
  } as const

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a panel splitter is a custom interactive widget by design
    <div
      ref={handle}
      {...separatorAria}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the splitter is focusable so the resize is keyboard-operable
      tabIndex={0}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative w-1.5 shrink-0 cursor-col-resize',
        focusRing,
        dragging && 'bg-accent',
      )}
    >
      {/* The painted line, over the panel boundary; the wider hit area stays invisible. */}
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
