import type { ContextChip } from '@coja/shared/api'
import { describe, expect, it, vi } from 'vitest'
import { bridge, createBridge } from './bridge'

const chip: ContextChip = {
  id: 'chip-1',
  kind: 'selection',
  path: 'src/auth.ts',
  ref: 'head',
  side: 'RIGHT',
  startLine: 41,
  endLine: 58,
  text: 'const x = 1',
}

describe('bridge', () => {
  it('delivers attached selections to every listener until they unsubscribe', () => {
    const b = createBridge()
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = b.onAttachSelection(first)
    b.onAttachSelection(second)

    b.attachSelection(chip)
    expect(first).toHaveBeenCalledWith(chip)
    expect(second).toHaveBeenCalledWith(chip)

    offFirst()
    b.attachSelection(chip)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('delivers scroll-to-line targets', () => {
    const b = createBridge()
    const listener = vi.fn()
    b.onScrollToLine(listener)
    b.scrollToLine({ path: 'src/auth.ts', line: 41, side: 'RIGHT' })
    expect(listener).toHaveBeenCalledWith({ path: 'src/auth.ts', line: 41, side: 'RIGHT' })
  })

  it('tolerates a listener unsubscribing during emit', () => {
    const b = createBridge()
    const second = vi.fn()
    const off = b.onScrollToLine(() => off())
    b.onScrollToLine(second)
    b.scrollToLine({ path: 'a', line: 1 })
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('exposes an app-wide singleton with the same shape', () => {
    const listener = vi.fn()
    const off = bridge.onAttachSelection(listener)
    bridge.attachSelection(chip)
    off()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
