import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { project, pullRequest, setupStatus } from '../test/fixtures'
import { deferred, installMockApi, jsonError } from '../test/mockApi'
import { renderAt } from '../test/render'

const base = {
  'GET /api/projects/p1/contributors': [],
  'GET /api/setup/status': setupStatus(),
  'GET /api/projects/p1': project({ id: 'p1', owner: 'octo', repo: 'repo' }),
}

type PullRequestPageShape = ReturnType<typeof pageOf>

/** A one-page PullRequestPage wrapping the given rows. */
function pageOf(items: unknown[], over: Record<string, unknown> = {}) {
  return { items, page: 1, perPage: 100, total: items.length, totalPages: 1, ...over }
}

it('renders a PR row with breadcrumb, badges, author, branches and relative time', async () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  installMockApi({
    ...base,
    'GET /api/projects/p1/prs': pageOf([
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
    ]),
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
  expect(screen.getByTitle('feat/thing → main').textContent).toContain('feat/thing')
  expect(screen.getByText('updated 5m ago').getAttribute('datetime')).toBe(fiveMinutesAgo)
  expect(screen.getByText('2 open')).toBeDefined()

  // One author has an avatar URL (24px image); the other falls back to an initial.
  // (The header's CJ mark is also an img now; count only list avatars.)
  const avatars = container.querySelectorAll<HTMLImageElement>('main ul img')
  expect(avatars[0]?.src).toBe('https://avatars.githubusercontent.com/u/1?v=4')
  expect(avatars[0]?.getAttribute('width')).toBe('24')
  expect(avatars[0]?.getAttribute('alt')).toBe('')
  expect(screen.getByText('m', { selector: 'span' })).toBeDefined()

  // Single page: no pager footer (the header count already says "2 open").
  expect(screen.queryByRole('navigation', { name: 'Pull request pages' })).toBeNull()
  expect(screen.queryByText(/open pull requests/)).toBeNull()

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
  installMockApi({
    ...base,
    'GET /api/projects/p1/prs': pageOf([pullRequest({ myReviewState: state })]),
  })
  renderAt('/p/p1')
  expect(await screen.findByText(label)).toBeDefined()
})

it('shows the empty state and refetches on Refresh', async () => {
  const mock = installMockApi({ ...base, 'GET /api/projects/p1/prs': pageOf([]) })
  renderAt('/p/p1')
  expect(await screen.findByText('No open pull requests')).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Refresh pull requests' }))
  await waitFor(() => expect(mock.callsTo('GET', '/api/projects/p1/prs')).toHaveLength(2))
})

it('shows the error message with a retry', async () => {
  installMockApi({
    ...base,
    'GET /api/projects/p1/prs': ({ count }) =>
      count === 0 ? jsonError(502, 'GitHub: bad gateway', 'github') : pageOf([pullRequest()]),
  })
  renderAt('/p/p1')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain("Couldn't load pull requests")
  expect(alert.textContent).toContain('GitHub: bad gateway')

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('link', { name: 'Add the thing' })).toBeDefined()
})

describe('pagination', () => {
  const big = (items: unknown[], page: number, total = 250) =>
    pageOf(items, { page, total, totalPages: Math.ceil(total / 100) })

  it('shows a windowed number line with ellipses and Showing X–Y of N', async () => {
    installMockApi({
      ...base,
      'GET /api/projects/p1/prs': big([pullRequest()], 5, 830),
    })
    renderAt('/p/p1?page=5')
    const nav = await screen.findByRole('navigation', { name: 'Pull request pages' })
    const labels = [...nav.querySelectorAll(':scope > button, :scope > span')].map(
      (el) => el.textContent,
    )
    expect(labels).toEqual(['←', '1', '…', '4', '5', '6', '…', '9', '→'])
    expect(screen.getByText('Showing 401–500 of 830')).toBeDefined()
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('5')
  })

  it('requests the page from the URL, and paging updates the URL and the fetch', async () => {
    const mock = installMockApi({
      ...base,
      'GET /api/projects/p1/prs': ({ url }) => {
        const page = Number(url.searchParams.get('page') ?? '1')
        return big([pullRequest({ number: page })], page, 830)
      },
    })
    renderAt('/p/p1')
    expect(await screen.findByRole('link', { name: 'Add the thing' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(mock.callsTo('GET', '/api/projects/p1/prs?page=2')).toHaveLength(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe(
        'page',
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    await waitFor(() => expect(mock.callsTo('GET', '/api/projects/p1/prs?page=3')).toHaveLength(1))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Page 3' }).getAttribute('aria-current')).toBe(
        'page',
      ),
    )
    // Back to page 1: served from the query cache; the selection moves back.
    fireEvent.click(screen.getByRole('button', { name: 'Page 1' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe(
        'page',
      ),
    )
  })

  it('shows skeletons while an uncached page fetches; cached pages render instantly', async () => {
    const held = deferred<PullRequestPageShape>()
    let page = 1
    const mock = installMockApi({
      ...base,
      'GET /api/projects/p1/prs': ({ url }) => {
        page = Number(url.searchParams.get('page') ?? '1')
        return page === 1 ? big([pullRequest()], 1, 830) : held.promise
      },
    })
    void mock
    renderAt('/p/p1')
    expect(await screen.findByRole('link', { name: 'Add the thing' })).toBeDefined()

    // Uncached page 2: skeletons while the fetch is held.
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('list', { name: 'Loading pull requests' })).toBeDefined()
    expect(screen.queryByRole('navigation', { name: 'Pull request pages' })).toBeNull()

    held.resolve(big([pullRequest({ number: 2 })], 2, 830))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe(
        'page',
      ),
    )
  })

  it('disables prev on the first page and next on the last', async () => {
    installMockApi({ ...base, 'GET /api/projects/p1/prs': big([pullRequest()], 9) })
    renderAt('/p/p1?page=9')
    await screen.findByRole('navigation', { name: 'Pull request pages' })
    expect(
      (screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled,
    ).toBe(false)
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe('windowedPages', () => {
  it('returns every page when few, and gaps the middle when many', async () => {
    const { windowedPages } = await import('./PullRequestListScreen')
    expect(windowedPages(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(windowedPages(5, 9)).toEqual([1, '…', 4, 5, 6, '…', 9])
    expect(windowedPages(1, 9)).toEqual([1, 2, '…', 9])
    expect(windowedPages(9, 9)).toEqual([1, '…', 8, 9])
  })
})

describe('filter bar', () => {
  it('loads closed PRs and renders their actual state, with distinct state queries', async () => {
    const mock = installMockApi({
      ...base,
      'GET /api/projects/p1/prs': ({ url }) =>
        pageOf([
          pullRequest({
            title: `${url.searchParams.get('state') ?? 'open'} result`,
            state: 'MERGED',
          }),
        ]),
    })
    renderAt('/p/p1?q=is:closed')
    await screen.findByRole('link', { name: 'closed result' })
    expect(screen.getByRole('heading', { name: 'Closed pull requests' })).toBeDefined()
    expect(screen.getByText('Merged', { selector: 'span' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    await screen.findByRole('link', { name: 'all result' })
    expect(mock.calls.some((c) => c.url.includes('state=all'))).toBe(true)
  })

  it('inserts suggestions using the keyboard and supports Escape without clearing the query', async () => {
    const mock = installMockApi({ ...base, 'GET /api/projects/p1/prs': pageOf([pullRequest()]) })
    renderAt('/p/p1')
    await screen.findByRole('link', { name: 'Add the thing' })
    const input = screen.getByRole('combobox', { name: 'Filter pull requests' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'is:cl' } })
    expect(screen.getByRole('option', { name: /is:closed/ })).toBeDefined()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('is:closed ')
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes('state=closed'))).toBe(true))
    fireEvent.change(input, { target: { value: 'is:closed author:' } })
    expect(screen.getByRole('option', { name: /author:hubot/ })).toBeDefined()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.value).toBe('is:closed author:')
  })

  it('ranks contributors before PR authors and deduplicates usernames', async () => {
    installMockApi({
      ...base,
      'GET /api/projects/p1/contributors': [
        { login: 'Julius', contributions: 900 },
        { login: 'hubot', contributions: 10 },
      ],
      'GET /api/projects/p1/prs': pageOf([
        pullRequest(),
        pullRequest({ id: 'PR_2', number: 2, title: 'New author', author: { login: 'newcomer' } }),
      ]),
    })
    renderAt('/p/p1')
    await screen.findByRole('link', { name: 'New author' })
    const input = screen.getByRole('combobox', { name: 'Filter pull requests' })
    fireEvent.change(input, { target: { value: 'author:' } })
    await screen.findByRole('option', { name: /author:Julius/ })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]?.textContent).toContain('author:Julius')
    expect(options[0]?.textContent).toContain('900 commits')
    expect(options[2]?.textContent).toContain('author:newcomer')
  })

  it('lets keyboard navigation reach authors beyond the first nine suggestions', async () => {
    installMockApi({
      ...base,
      'GET /api/projects/p1/prs': pageOf(
        Array.from({ length: 12 }, (_, index) =>
          pullRequest({
            id: `PR_${index}`,
            number: index + 1,
            title: `PR ${index}`,
            author: { login: index === 11 ? 'julius' : `author${index}` },
          }),
        ),
      ),
    })
    renderAt('/p/p1')
    await screen.findByRole('link', { name: 'PR 0' })
    const input = screen.getByRole('combobox', { name: 'Filter pull requests' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'author:' } })
    expect(screen.getAllByRole('option')).toHaveLength(12)
    for (let i = 0; i < 12; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(
      screen.getByRole('option', { name: /author:julius/ }).getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(
      screen.getByRole('option', { name: /author:author0/ }).getAttribute('aria-selected'),
    ).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('author:julius ')
  })

  it('completes known branches with the mouse and resets pagination while preserving filters', async () => {
    const mock = installMockApi({ ...base, 'GET /api/projects/p1/prs': pageOf([pullRequest()]) })
    renderAt('/p/p1?page=3&q=is:closed')
    await screen.findByRole('link', { name: 'Add the thing' })
    const input = screen.getByRole('combobox', { name: 'Filter pull requests' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'is:closed base:ma' } })
    fireEvent.click(screen.getByRole('option', { name: /base:main/ }))
    expect(input.value).toBe('is:closed base:main ')
    await waitFor(() =>
      expect(
        mock.calls.some(
          (c) =>
            c.url.includes('state=closed') &&
            c.url.includes('base=main') &&
            !c.url.includes('page='),
        ),
      ).toBe(true),
    )
  })

  it('parses qualifiers and text from one query box into the fetch', async () => {
    const mock = installMockApi({
      ...base,
      'GET /api/projects/p1/prs': pageOf([pullRequest({ title: 'Add the thing' })]),
    })
    renderAt('/p/p1')
    expect(await screen.findByRole('link', { name: 'Add the thing' })).toBeDefined()

    const input = screen.getByRole('combobox', { name: 'Filter pull requests' })
    fireEvent.change(input, { target: { value: 'author:alice is:draft fix login' } })
    await waitFor(() =>
      expect(
        mock.calls.some(
          (c) =>
            c.url.includes('author=alice') &&
            c.url.includes('draft=true') &&
            decodeURIComponent(c.url).includes('fix+login'),
        ),
      ).toBe(true),
    )
    // Valid qualifiers are highlighted within the editable query.
    expect(screen.getByText('author:alice')).toBeDefined()
    expect(
      screen.getAllByText('is:draft').some((node) => node.className.includes('text-accent')),
    ).toBe(true)
  })

  it('highlights valid qualifiers inline and keeps invalid qualifiers plain', async () => {
    installMockApi({ ...base, 'GET /api/projects/p1/prs': pageOf([pullRequest()]) })
    renderAt(`/p/p1?q=${encodeURIComponent('author:alice draft:false draft:maybe')}`)
    expect(await screen.findByRole('link', { name: 'Add the thing' })).toBeDefined()
    expect(screen.getByText('author:alice').className).toContain('text-accent')
    expect(screen.getByText('draft:false').className).toContain('text-accent')
    expect(screen.getByText('draft:maybe').className).not.toContain('text-accent')
    const input = screen.getByRole('combobox', { name: 'Filter pull requests' })
    fireEvent.change(input, { target: { value: 'author:alice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.queryByText('draft:false')).toBeNull())
  })

  it('cancels pending edits when cleared and preserves focus after applying', async () => {
    const mock = installMockApi({ ...base, 'GET /api/projects/p1/prs': pageOf([pullRequest()]) })
    renderAt('/p/p1')
    await screen.findByRole('link', { name: 'Add the thing' })
    const input = screen.getByRole('combobox', {
      name: 'Filter pull requests',
    }) as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'author:alice ' } })
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes('author=alice'))).toBe(true))
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('author:alice ')
    fireEvent.change(input, { target: { value: 'author:bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear query' }))
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(input.value).toBe('')
    expect(mock.calls.some((c) => c.url.includes('author=bob'))).toBe(false)
  })

  it('Clear empties the query and returns to the unfiltered list', async () => {
    const mock = installMockApi({ ...base, 'GET /api/projects/p1/prs': pageOf([pullRequest()]) })
    renderAt(`/p/p1?q=${encodeURIComponent('author:alice')}`)
    expect(await screen.findByRole('link', { name: 'Add the thing' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))
    await waitFor(() =>
      expect(
        (screen.getByRole('combobox', { name: 'Filter pull requests' }) as HTMLInputElement).value,
      ).toBe(''),
    )
    await waitFor(() => expect(mock.calls.some((c) => c.url === '/api/projects/p1/prs')).toBe(true))
  })

  it('shows the filtered empty state with a Clear filters action', async () => {
    installMockApi({
      ...base,
      'GET /api/projects/p1/prs': ({ url }) =>
        url.searchParams.get('text') === 'nomatch' ? pageOf([]) : pageOf([pullRequest()]),
    })
    renderAt('/p/p1?q=nomatch')
    expect(await screen.findByText('No pull requests match these filters.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByRole('link', { name: 'Add the thing' })).toBeDefined()
  })
})
