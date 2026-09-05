import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { project, pullRequest, setupStatus } from '../test/fixtures'
import { installMockApi, jsonError } from '../test/mockApi'
import { renderAt } from '../test/render'

const base = {
  'GET /api/setup/status': setupStatus(),
  'GET /api/projects/p1': project({ id: 'p1', owner: 'octo', repo: 'repo' }),
}

it('renders a PR row with breadcrumb, badges, author, branches and relative time', async () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  installMockApi({
    ...base,
    'GET /api/projects/p1/prs': [
      pullRequest({
        number: 42,
        title: 'Add the thing',
        isDraft: true,
        myReviewState: 'changes_requested',
        updatedAt: fiveMinutesAgo,
      }),
      pullRequest({
        id: 'PR_2',
        number: 7,
        title: 'Fix typo',
        headRefName: 'fix/typo',
        author: { login: 'monalisa' },
        myReviewState: 'none',
      }),
    ],
  })
  const { container } = renderAt('/p/p1')

  const title = await screen.findByRole('link', { name: 'Add the thing' })
  expect(title.getAttribute('href')).toBe('/p/p1/pr/42')
  expect(screen.getByText('octo/repo')).toBeDefined()
  expect(screen.getByText('#42')).toBeDefined()
  expect(screen.getByText('Draft')).toBeDefined()
  expect(screen.getByText('Changes requested')).toBeDefined()
  expect(screen.getByText('hubot')).toBeDefined()
  expect(screen.getByText('monalisa')).toBeDefined()
  expect(screen.getByText('feat/thing → main')).toBeDefined()
  expect(screen.getByText('5m ago').getAttribute('datetime')).toBe(fiveMinutesAgo)
  expect(screen.getByText('2 open')).toBeDefined()

  // One author has an avatar URL (24px image); the other falls back to an initial.
  const avatars = container.querySelectorAll('img')
  expect(avatars).toHaveLength(1)
  expect(avatars[0]?.src).toBe('https://avatars.githubusercontent.com/u/1?v=4')
  expect(avatars[0]?.getAttribute('width')).toBe('24')
  expect(avatars[0]?.getAttribute('alt')).toBe('')
  expect(screen.getByText('m', { selector: 'span' })).toBeDefined()

  // 'none' renders no review badge at all.
  expect(screen.queryByText('Pending review')).toBeNull()
  expect(screen.queryByText('Approved')).toBeNull()
  expect(screen.queryByText('Commented')).toBeNull()
})

it.each([
  ['pending', 'Pending review'],
  ['approved', 'Approved'],
  ['commented', 'Commented'],
] as const)('shows the %s review state as "%s"', async (state, label) => {
  installMockApi({ ...base, 'GET /api/projects/p1/prs': [pullRequest({ myReviewState: state })] })
  renderAt('/p/p1')
  expect(await screen.findByText(label)).toBeDefined()
})

it('shows the empty state and refetches on Refresh', async () => {
  const mock = installMockApi({ ...base, 'GET /api/projects/p1/prs': [] })
  renderAt('/p/p1')
  expect(await screen.findByText('No open pull requests')).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(mock.callsTo('GET', '/api/projects/p1/prs')).toHaveLength(2))
})

it('shows the error message with a retry', async () => {
  installMockApi({
    ...base,
    'GET /api/projects/p1/prs': ({ count }) =>
      count === 0 ? jsonError(502, 'GitHub: bad gateway', 'github') : [pullRequest()],
  })
  renderAt('/p/p1')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain("Couldn't load pull requests")
  expect(alert.textContent).toContain('GitHub: bad gateway')

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('link', { name: 'Add the thing' })).toBeDefined()
})
