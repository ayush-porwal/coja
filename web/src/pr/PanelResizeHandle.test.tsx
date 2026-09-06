import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PANEL_RESIZE_STEP, PANEL_RESIZE_STEP_LARGE, PanelResizeHandle } from './PanelResizeHandle'

function Harness({
  side,
  min = 200,
  max = 460,
  initial = 288,
  onResize,
}: {
  side: 'left' | 'right'
  min?: number
  max?: number
  initial?: number
  onResize?: (width: number) => void
}) {
  const [width, setWidth] = useState(initial)
  return (
    <div style={{ display: 'flex' }}>
      <PanelResizeHandle
        side={side}
        width={width}
        onResize={(next) => {
          setWidth(next)
          onResize?.(next)
        }}
        label="Resize test panel"
        min={min}
        max={max}
      />
    </div>
  )
}

describe('PanelResizeHandle', () => {
  it('renders a vertical separator mirroring the panel width', () => {
    render(<Harness side="left" initial={288} />)
    const handle = screen.getByRole('separator', { name: 'Resize test panel' })
    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle.getAttribute('aria-valuenow')).toBe('288')
    expect(handle.getAttribute('aria-valuemin')).toBe('200')
    expect(handle.getAttribute('aria-valuemax')).toBe('460')
  })

  it('drags: pointer moves over the row set the width from the pointer position', () => {
    const onResize = vi.fn()
    render(<Harness side="left" onResize={onResize} />)
    const handle = screen.getByRole('separator', { name: 'Resize test panel' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 300 })
    // jsdom rects are 0, so width = clientX; one move to 340, one beyond the max, then release.
    fireEvent(window, new PointerEvent('pointermove', { clientX: 340 }))
    fireEvent(window, new PointerEvent('pointermove', { clientX: 9999 }))
    fireEvent(window, new PointerEvent('pointerup', { clientX: 9999 }))
    expect(onResize).toHaveBeenNthCalledWith(1, 340)
    expect(onResize).toHaveBeenNthCalledWith(2, 460) // clamped to max
    // The listeners are gone: moves after pointerup do nothing.
    fireEvent(window, new PointerEvent('pointermove', { clientX: 200 }))
    expect(onResize).toHaveBeenCalledTimes(2)
  })

  it('releases drag listeners and the selection lock when the panel unmounts', () => {
    const onResize = vi.fn()
    const view = render(<Harness side="left" onResize={onResize} />)
    fireEvent.pointerDown(screen.getByRole('separator'), { button: 0 })
    expect(document.body.classList.contains('coja-resizing')).toBe(true)
    view.unmount()
    expect(document.body.classList.contains('coja-resizing')).toBe(false)
    fireEvent(window, new PointerEvent('pointermove', { clientX: 340 }))
    expect(onResize).not.toHaveBeenCalled()
  })

  it('ends a cancelled pointer drag', () => {
    const onResize = vi.fn()
    render(<Harness side="left" onResize={onResize} />)
    fireEvent.pointerDown(screen.getByRole('separator'), { button: 0 })
    fireEvent(window, new PointerEvent('pointercancel'))
    fireEvent(window, new PointerEvent('pointermove', { clientX: 340 }))
    expect(document.body.classList.contains('coja-resizing')).toBe(false)
    expect(onResize).not.toHaveBeenCalled()
  })

  it('grows and shrinks with the arrow keys, Shift for larger steps', () => {
    const onResize = vi.fn()
    render(<Harness side="left" initial={288} onResize={onResize} />)
    const handle = screen.getByRole('separator', { name: 'Resize test panel' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(288 + PANEL_RESIZE_STEP)
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(288) // back from 312
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
    expect(onResize).toHaveBeenLastCalledWith(288 + PANEL_RESIZE_STEP_LARGE)
  })

  it('mirrors the arrows for a right-side panel: ArrowRight grows', () => {
    const onResize = vi.fn()
    render(<Harness side="right" initial={380} onResize={onResize} />)
    const handle = screen.getByRole('separator', { name: 'Resize test panel' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith(380 + PANEL_RESIZE_STEP)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(380) // back from 404
  })

  it('Home and End jump to the bounds', () => {
    const onResize = vi.fn()
    render(<Harness side="left" onResize={onResize} />)
    const handle = screen.getByRole('separator', { name: 'Resize test panel' })
    fireEvent.keyDown(handle, { key: 'End' })
    expect(onResize).toHaveBeenLastCalledWith(460)
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(onResize).toHaveBeenLastCalledWith(200)
  })
})
