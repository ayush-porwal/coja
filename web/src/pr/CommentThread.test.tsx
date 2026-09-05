import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { CommentThread } from './CommentThread'
import { makeComment, makeThread } from './testFixtures'

function renderThread(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('CommentThread', () => {
  it('shows a Pending badge only for pending comments and renders bodies as HTML', () => {
    const thread = makeThread({
      comments: [
        makeComment({ id: 'C1', bodyHTML: '<p>Published <code>thing</code></p>' }),
        makeComment({
          id: 'C2',
          isPending: true,
          bodyHTML: '<p>Draft note</p>',
          author: { login: 'me' },
        }),
      ],
    })
    renderThread(<CommentThread projectId="p" number={1} thread={thread} />)

    const items = screen.getAllByRole('article')
    expect(items).toHaveLength(2)
    expect(within(items[0] as HTMLElement).queryByText('Pending')).toBeNull()
    expect(within(items[1] as HTMLElement).getByText('Pending')).toBeDefined()
    expect(screen.getByText('thing').tagName).toBe('CODE')
    expect(screen.getByPlaceholderText(/published immediately/)).toBeDefined()
  })

  it('shows Edit/Delete only for my comments', () => {
    const thread = makeThread({
      comments: [makeComment({ id: 'C1' }), makeComment({ id: 'C2', isMine: true })],
    })
    renderThread(<CommentThread projectId="p" number={1} thread={thread} />)
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1)
  })

  it('labels resolved and outdated threads and points at the original line', () => {
    renderThread(
      <CommentThread
        projectId="p"
        number={1}
        thread={makeThread({ isResolved: true, isOutdated: true, line: null, originalLine: 33 })}
      />,
    )
    expect(screen.getByText('Resolved')).toBeDefined()
    expect(screen.getByText('Outdated')).toBeDefined()
    expect(screen.getByText(/originally on line 33/)).toBeDefined()
  })
})
