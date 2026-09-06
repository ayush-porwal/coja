import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

const props = { open: true, title: 'Delete chat?', onConfirm: vi.fn(), onCancel: vi.fn() }

describe('ConfirmDialog keyboard navigation', () => {
  it('cycles forward and backward through both actions', () => {
    render(<ConfirmDialog {...props} />)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Tab' })
    expect(document.activeElement).toBe(confirm)
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
  })

  it('retains focus and ignores dismissal while an action is pending', () => {
    const onCancel = vi.fn()
    const view = render(<ConfirmDialog {...props} onCancel={onCancel} />)
    view.rerender(<ConfirmDialog {...props} onCancel={onCancel} busy />)
    const dialog = screen.getByRole('alertdialog')
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('returns focus to the opener when closed', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<ConfirmDialog {...props} />)
    view.rerender(<ConfirmDialog {...props} open={false} />)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
