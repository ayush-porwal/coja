import type { Project } from '@coja/shared/api'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { project, setupStatus } from '../test/fixtures'
import { deferred, installMockApi, jsonError } from '../test/mockApi'
import { currentPath, renderAt } from '../test/render'

it('shows the empty state and adds a local clone with the right body', async () => {
  const created = project({ id: 'p9', path: '/Users/me/src/repo' })
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus(),
    'GET /api/projects': ({ count }) => (count === 0 ? [] : [created]),
    'POST /api/projects': created,
    'GET /api/projects/p9': created,
    'GET /api/projects/p9/prs': [],
  })
  renderAt('/')

  expect(await screen.findByRole('heading', { name: 'Add a project' })).toBeDefined()
  expect(screen.getByText(/to identify the GitHub repo/)).toBeDefined()

  const submit = screen.getByRole('button', { name: 'Add project' }) as HTMLButtonElement
  expect(submit.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Path to a local clone'), {
    target: { value: ' /Users/me/src/repo ' },
  })
  expect(submit.disabled).toBe(false)
  fireEvent.click(submit)

  expect(await screen.findByText('No open pull requests')).toBeDefined()
  expect(currentPath()).toBe('/p/p9')
  expect(mock.callsTo('POST', '/api/projects')[0]?.body).toEqual({
    kind: 'local',
    path: '/Users/me/src/repo',
  })
})

it('clones from GitHub, showing "Cloning…" while the request is in flight', async () => {
  const created = project({ id: 'c1', kind: 'clone', owner: 'octo', repo: 'clone-me' })
  const pending = deferred<Project>()
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus(),
    'GET /api/projects': [],
    'POST /api/projects': () => pending.promise,
    'GET /api/projects/c1': created,
    'GET /api/projects/c1/prs': [],
  })
  renderAt('/')
  await screen.findByRole('heading', { name: 'Add a project' })

  const cloneTab = screen.getByRole('button', { name: 'Clone from GitHub' })
  fireEvent.click(cloneTab)
  expect(cloneTab.getAttribute('aria-pressed')).toBe('true')
  fireEvent.change(screen.getByLabelText('GitHub repository'), {
    target: { value: 'octo/clone-me' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add project' }))

  const cloning = await screen.findByText('Cloning…')
  expect((cloning as HTMLButtonElement).disabled).toBe(true)
  expect(mock.callsTo('POST', '/api/projects')[0]?.body).toEqual({
    kind: 'clone',
    slug: 'octo/clone-me',
  })

  pending.resolve(created)
  await waitFor(() => expect(currentPath()).toBe('/p/c1'))
})

it('shows the server error inline when adding fails', async () => {
  installMockApi({
    'GET /api/setup/status': setupStatus(),
    'GET /api/projects': [],
    'POST /api/projects': () => jsonError(400, 'Not a git repository: /nope', 'bad_request'),
  })
  renderAt('/')
  await screen.findByRole('heading', { name: 'Add a project' })

  fireEvent.change(screen.getByLabelText('Path to a local clone'), { target: { value: '/nope' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add project' }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Not a git repository: /nope')
  expect(currentPath()).toBe('/')
})

it('lists projects with kind badges and removes one after confirming', async () => {
  const local = project({ id: 'p1', kind: 'local', owner: 'octo', repo: 'repo' })
  const cloned = project({
    id: 'p2',
    kind: 'clone',
    owner: 'acme',
    repo: 'widgets',
    path: '/Users/me/Library/Application Support/coja/repos/acme__widgets.git',
  })
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus(),
    'GET /api/projects': ({ count }) => (count === 0 ? [local, cloned] : [cloned]),
    'DELETE /api/projects/p1': { ok: true },
  })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  renderAt('/')

  const openLink = await screen.findByRole('link', { name: 'Open octo/repo' })
  expect(openLink.getAttribute('href')).toBe('/p/p1')
  expect(screen.getByText('local clone')).toBeDefined()
  expect(screen.getByText('cloned')).toBeDefined()
  expect(screen.getByText(cloned.path)).toBeDefined()
  expect(screen.getByRole('heading', { name: 'Add project' })).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Remove octo/repo' }))
  expect(confirm).toHaveBeenCalledWith(
    'Remove octo/repo from coja? Your clone on disk is left untouched.',
  )
  await waitFor(() => expect(mock.callsTo('DELETE', '/api/projects/p1')).toHaveLength(1))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Open octo/repo' })).toBeNull())
  expect(screen.getByRole('link', { name: 'Open acme/widgets' })).toBeDefined()
})

it('does not delete when the confirm dialog is dismissed', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus(),
    'GET /api/projects': [project()],
  })
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  renderAt('/')
  fireEvent.click(await screen.findByRole('button', { name: 'Remove octo/repo' }))
  expect(mock.callsTo('DELETE', '/api/projects/p1')).toHaveLength(0)
})
