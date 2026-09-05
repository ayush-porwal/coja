import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SPLIT_MAX, SPLIT_MIN, SPLIT_STEP, SPLIT_STEP_LARGE, SplitDivider } from './SplitDivider'

function Harness({
  initial = 50,
  onResize,
}: {
  initial?: number
  onResize?: (pct: number) => void
}) {
  const [pct, setPct] = useState(initial)
  return (
    <div style={{ position: 'relative' }}>
      <SplitDivider
        leftPct={pct}
        onChange={(next) => {
          setPct(next)
          onResize?.(next)
        }}
      />
    </div>
  )
}

const divider = () => screen.getByRole('separator', { name: 'Resize split columns' })

describe('SplitDivider', () => {
  it('mirrors the left-column percentage to assistive tech', () => {
    render(<Harness initial={62} />)
    const handle = divider()
    expect(handle.getAttribute('aria-valuenow')).toBe('62')
    expect(handle.getAttribute('aria-valuemin')).toBe(String(SPLIT_MIN))
    expect(handle.getAttribute('aria-valuemax')).toBe(String(SPLIT_MAX))
  })

  it('drags: pointer position over the pane becomes the left percentage, clamped', () => {
    const onResize = vi.fn()
    const { container } = render(<Harness onResize={onResize} />)
    const pane = container.firstElementChild as HTMLElement
    pane.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 500,
        height: 100,
        top: 0,
        right: 500,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    fireEvent.pointerDown(divider(), { button: 0, clientX: 250 })
    fireEvent(window, new PointerEvent('pointermove', { clientX: 125 }))
    fireEvent(window, new PointerEvent('pointermove', { clientX: 99999 }))
    fireEvent(window, new PointerEvent('pointerup', { clientX: 99999 }))
    expect(onResize).toHaveBeenNthCalledWith(1, 25)
    expect(onResize).toHaveBeenNthCalledWith(2, SPLIT_MAX)
    fireEvent(window, new PointerEvent('pointermove', { clientX: 10 }))
    expect(onResize).toHaveBeenCalledTimes(2)
  })

  it('moves with the arrow keys (Shift for larger steps) and jumps with Home/End', () => {
    const onResize = vi.fn()
    render(<Harness initial={50} onResize={onResize} />)
    const handle = divider()
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    fireEvent.keyDown(handle, { key: 'Home' })
    fireEvent.keyDown(handle, { key: 'End' })
    const calls = onResize.mock.calls.map((c) => c[0])
    expect(calls).toEqual([50 - SPLIT_STEP, 50, 50 - SPLIT_STEP_LARGE, SPLIT_MIN, SPLIT_MAX])
  })
})
