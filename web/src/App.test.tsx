import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { setupStatus } from './test/fixtures'
import { installMockApi, jsonError } from './test/mockApi'
import { currentPath, renderAt } from './test/render'

it('shows a splash while the setup status loads', () => {
  installMockApi({ 'GET /api/setup/status': () => new Promise(() => {}) })
  renderAt('/')
  expect(screen.getByRole('img', { name: 'Loading coja' })).toBeDefined()
  expect(screen.getByText('Loading coja')).toBeDefined()
  expect(screen.queryByRole('heading')).toBeNull()
})

it('redirects to /setup when setup is not complete', async () => {
  installMockApi({ 'GET /api/setup/status': setupStatus({ setupComplete: false }) })
  renderAt('/')
  expect(await screen.findByRole('heading', { name: 'Set up coja' })).toBeDefined()
  expect(currentPath()).toBe('/setup')
})

it('redirects to /setup when gh is broken, even after setup was completed', async () => {
  installMockApi({
    'GET /api/setup/status': setupStatus({
      gh: { ok: false, error: 'gh is not logged in. Run `gh auth login` in your terminal.' },
      setupComplete: true,
    }),
  })
  renderAt('/p/p1')
  expect(await screen.findByRole('heading', { name: 'Set up coja' })).toBeDefined()
  expect(currentPath()).toBe('/setup')
})

it('stays on / when setup is complete', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus(),
    'GET /api/projects': [],
  })
  renderAt('/')
  expect(await screen.findByRole('heading', { name: 'Projects' })).toBeDefined()
  expect(currentPath()).toBe('/')
  expect(mock.callsTo('GET', '/api/setup/status')).toHaveLength(1)
})

it('lets a completed setup visit /setup without bouncing away', async () => {
  installMockApi({ 'GET /api/setup/status': setupStatus() })
  renderAt('/setup')
  expect(await screen.findByRole('heading', { name: 'Set up coja' })).toBeDefined()
  expect(currentPath()).toBe('/setup')
})

it('shows an error with retry when the server is unreachable', async () => {
  installMockApi({
    'GET /api/setup/status': ({ count }) => {
      if (count === 0) throw new TypeError('Failed to fetch')
      return setupStatus()
    },
    'GET /api/projects': [],
  })
  renderAt('/')
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain("coja can't reach its server")
  expect(alert.textContent).toContain('Failed to fetch')

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('heading', { name: 'Projects' })).toBeDefined()
})

it('retries the failed status request once before showing the error', async () => {
  const mock = installMockApi({ 'GET /api/setup/status': () => jsonError(502, 'Bad Gateway') })
  renderAt('/', { retry: 1, retryDelay: 0 })
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Bad Gateway')
  expect(mock.callsTo('GET', '/api/setup/status')).toHaveLength(2)
})

it('renders a not-found page for unknown routes', async () => {
  installMockApi({ 'GET /api/setup/status': setupStatus() })
  renderAt('/nope')
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeDefined()
  await waitFor(() => expect(currentPath()).toBe('/nope'))
})
