import type { FetchStatus, PullRequestDetail } from '@coja/shared/api'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'
import type { DiffStyle } from './types'

function renderBar(
  overrides: {
    view?: 'conversation' | 'changes'
    diffStyle?: DiffStyle
    onConversation?: () => void
    onChanges?: (style: DiffStyle) => void
  } = {},
) {
  const props = {
    projectId: 'p1',
    number: 1,
    detail: undefined as PullRequestDetail | undefined,
    fetchStatus: { state: 'ready' } as FetchStatus,
    fetchError: null,
    onRetryFetch: vi.fn(),
    view: (overrides.view ?? 'changes') as 'conversation' | 'changes',
    diffStyle: (overrides.diffStyle ?? 'unified') as DiffStyle,
    onConversation: overrides.onConversation ?? vi.fn(),
    onChanges: overrides.onChanges ?? vi.fn(),
    treeOpen: true,
    onToggleTree: vi.fn(),
    aiOpen: true,
    onToggleAi: vi.fn(),
    threadCount: 0,
    chipCount: 0,
    onOpenReview: vi.fn(),
  }
  render(
    <MemoryRouter>
      <TopBar {...props} />
    </MemoryRouter>,
  )
  return props
}

describe('TopBar view group', () => {
  it('renders the three segments with the active one pressed', () => {
    renderBar({ view: 'changes', diffStyle: 'split' })
    expect(screen.getByRole('button', { name: 'Conversation' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(
      screen.getByRole('button', { name: 'Changes, stacked' }).getAttribute('aria-pressed'),
    ).toBe('false')
    expect(
      screen.getByRole('button', { name: 'Changes, split' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('marks Conversation active while the conversation view is shown', () => {
    renderBar({ view: 'conversation' })
    expect(screen.getByRole('button', { name: 'Conversation' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(
      screen.getByRole('button', { name: 'Changes, stacked' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('asks for the Changes view with a layout when a diff segment is clicked', () => {
    const onChanges = vi.fn()
    renderBar({ view: 'conversation', onChanges })
    fireEvent.click(screen.getByRole('button', { name: 'Changes, split' }))
    expect(onChanges).toHaveBeenCalledWith('split')
    fireEvent.click(screen.getByRole('button', { name: 'Changes, stacked' }))
    expect(onChanges).toHaveBeenCalledWith('unified')
  })

  it('asks for the Conversation view when its segment is clicked', () => {
    const onConversation = vi.fn()
    renderBar({ view: 'changes', onConversation })
    fireEvent.click(screen.getByRole('button', { name: 'Conversation' }))
    expect(onConversation).toHaveBeenCalledTimes(1)
  })

  it('keeps the theme menu out of the review bar', () => {
    renderBar()
    expect(screen.queryByTitle(/Theme/)).toBeNull()
  })
})
