import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installMockApi, type MockRoutes } from '../test/mockApi'
import { ReviewDialog } from './ReviewDialog'

const REVIEW_ROUTE = '/api/projects/p1/prs/7/review'

function renderDialog(routes: MockRoutes, props?: Partial<Parameters<typeof ReviewDialog>[0]>) {
  const mock = installMockApi(routes)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onDone = vi.fn()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <ReviewDialog
        open
        projectId="p1"
        number={7}
        pendingCount={0}
        hasPendingReview={false}
        onClose={onClose}
        onDone={onDone}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { mock, onDone, onClose }
}

describe('ReviewDialog', () => {
  it('confirms before discarding a pending review; cancelling never deletes', async () => {
    const { mock, onDone, onClose } = renderDialog(
      { [`DELETE ${REVIEW_ROUTE}`]: { ok: true } },
      { pendingCount: 2, hasPendingReview: true },
    )
    expect(await screen.findByText('Submit review')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Discard pending review' }))
    // The confirm modal states the consequence, portaled inside the native dialog.
    const confirm = await screen.findByRole('alertdialog')
    expect(screen.getByText('Discard pending review?')).toBeDefined()
    expect(
      screen.getByText(
        'Its 2 pending comments and the summary are removed. This cannot be undone.',
      ),
    ).toBeDefined()

    // Both actions live in the confirm; the review dialog has its own Cancel.
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(mock.callsTo('DELETE', REVIEW_ROUTE)).toHaveLength(0)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Discard pending review' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }),
    )
    await waitFor(() => expect(mock.callsTo('DELETE', REVIEW_ROUTE)).toHaveLength(1))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onDone).toHaveBeenCalledWith('Pending review discarded')
  })

  it('scopes Escape to the confirm modal while it is open', async () => {
    renderDialog({}, { pendingCount: 1, hasPendingReview: true })
    expect(await screen.findByText('Submit review')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Discard pending review' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.keyDown(confirm, { key: 'Escape' })

    // The confirm closes; the review dialog underneath stays open.
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('Submit review')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Discard pending review' })).toBeDefined()
  })

  it('submits an approve review with the summary body', async () => {
    const { mock, onDone, onClose } = renderDialog({
      [`POST ${REVIEW_ROUTE}`]: { state: 'APPROVED' },
    })
    expect(await screen.findByText('Submit review')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'ship it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(mock.callsTo('POST', REVIEW_ROUTE)).toHaveLength(1))
    expect(mock.callsTo('POST', REVIEW_ROUTE)[0]?.body).toEqual({
      event: 'APPROVE',
      body: 'ship it',
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onDone).toHaveBeenCalledWith('Review submitted — approved')
  })
})
