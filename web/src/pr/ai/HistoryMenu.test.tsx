import type { Chat } from '@coja/shared/api'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryMenu } from './HistoryMenu'

const chats: Chat[] = ['First chat', 'Current chat'].map((title, index) => ({
  id: String(index),
  title,
  projectId: 'p1',
  prNumber: 1,
  model: 'test-model',
  createdAt: '2026-09-06T10:00:00Z',
  updatedAt: '2026-09-06T10:00:00Z',
}))

describe('HistoryMenu focus', () => {
  it('focuses the current chat and restores the trigger on Escape', () => {
    render(
      <HistoryMenu
        chats={chats}
        loading={false}
        currentId="1"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'History (2)' })
    fireEvent.click(trigger)
    const current = screen.getByRole('button', { current: true })
    expect(document.activeElement).toBe(current)
    fireEvent.keyDown(current, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Chat history' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps an empty history dismissible by keyboard', () => {
    render(
      <HistoryMenu
        chats={[]}
        loading={false}
        currentId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'History' })
    fireEvent.click(trigger)
    const panel = screen.getByRole('region', { name: 'Chat history' })
    expect(document.activeElement).toBe(panel)
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
    expect(screen.queryByRole('region', { name: 'Chat history' })).toBeNull()
  })

  it('closes and gives the delete confirmation a stable return-focus target', () => {
    const onDelete = vi.fn()
    render(
      <HistoryMenu
        chats={chats}
        loading={false}
        currentId="1"
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'History (2)' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Delete chat First chat' }))
    expect(onDelete).toHaveBeenCalledWith('0')
    expect(screen.queryByRole('region', { name: 'Chat history' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
