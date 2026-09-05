import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePanelShortcuts } from './usePanelShortcuts'

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
}

describe('usePanelShortcuts', () => {
  it('toggles the file tree on Cmd/Ctrl+B', () => {
    const tree = vi.fn()
    const ai = vi.fn()
    renderHook(() => usePanelShortcuts({ onToggleTree: tree, onToggleAi: ai }))
    press('b', { metaKey: true })
    press('b', { ctrlKey: true })
    expect(tree).toHaveBeenCalledTimes(2)
    expect(ai).not.toHaveBeenCalled()
  })

  it('toggles the AI panel on Cmd/Ctrl+Shift+B', () => {
    const tree = vi.fn()
    const ai = vi.fn()
    renderHook(() => usePanelShortcuts({ onToggleTree: tree, onToggleAi: ai }))
    press('B', { metaKey: true, shiftKey: true })
    press('B', { ctrlKey: true, shiftKey: true })
    expect(ai).toHaveBeenCalledTimes(2)
    expect(tree).not.toHaveBeenCalled()
  })

  it('ignores plain B, Alt chords and other keys', () => {
    const tree = vi.fn()
    const ai = vi.fn()
    renderHook(() => usePanelShortcuts({ onToggleTree: tree, onToggleAi: ai }))
    press('b')
    press('b', { metaKey: true, altKey: true })
    press('n', { metaKey: true })
    expect(tree).not.toHaveBeenCalled()
    expect(ai).not.toHaveBeenCalled()
  })
})
