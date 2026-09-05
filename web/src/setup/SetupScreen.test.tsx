import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { setupStatus } from '../test/fixtures'
import { installMockApi, jsonError } from '../test/mockApi'
import { currentPath, renderAt } from '../test/render'

const GH_ERROR = 'gh is not logged in. Run `gh auth login` in your terminal.'

it('shows the gh error with a retry, then the signed-in state after re-checking', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': ({ count }) =>
      count === 0
        ? setupStatus({ gh: { ok: false, error: GH_ERROR }, setupComplete: false })
        : setupStatus({ setupComplete: false }),
  })
  renderAt('/setup')

  expect(await screen.findByText(GH_ERROR)).toBeDefined()
  const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
  expect(cont.disabled).toBe(true)
  expect(
    (screen.getByRole('button', { name: 'Skip AI for now' }) as HTMLButtonElement).disabled,
  ).toBe(true)

  fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
  expect(await screen.findByText('Signed in as', { exact: false })).toBeDefined()
  expect(screen.getByText('octocat')).toBeDefined()
  expect(mock.callsTo('GET', '/api/setup/status')).toHaveLength(2)
  await waitFor(() => expect(cont.disabled).toBe(false))
})

it('shows configured providers with a Remove button and hides "Skip AI"', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': ({ count }) =>
      setupStatus({
        providers: { openai: { configured: count === 0 }, anthropic: { configured: false } },
      }),
    'DELETE /api/setup/key?provider=openai': { ok: true },
  })
  renderAt('/setup')

  expect(await screen.findByText('Signed in as', { exact: false })).toBeDefined()
  expect(screen.getByText('OpenAI', { selector: 'span' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Skip AI for now' })).toBeNull()
  expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
    false,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Remove OpenAI key' }))
  await waitFor(() =>
    expect(mock.callsTo('DELETE', '/api/setup/key?provider=openai')).toHaveLength(1),
  )
  // The status is refetched and the provider is gone.
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Remove OpenAI key' })).toBeNull(),
  )
  expect(screen.getByRole('button', { name: 'Skip AI for now' })).toBeDefined()
})

it('posts the key, shows a 400 inline, then the configured state on success', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': ({ count }) =>
      setupStatus({
        setupComplete: false,
        providers: { openai: { configured: false }, anthropic: { configured: count >= 1 } },
      }),
    'POST /api/setup/key': ({ count }) =>
      count === 0
        ? jsonError(400, 'Anthropic rejected the key (401 Unauthorized)', 'provider')
        : { ok: true, provider: 'anthropic' },
  })
  renderAt('/setup')
  await screen.findByRole('heading', { name: 'Set up coja' })

  const save = screen.getByRole('button', { name: 'Save & validate' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)

  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'anthropic' } })
  const key = screen.getByLabelText('API key') as HTMLInputElement
  expect(key.type).toBe('password')
  fireEvent.change(key, { target: { value: '  sk-ant-test  ' } })
  expect(save.disabled).toBe(false)
  fireEvent.click(save)

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Anthropic rejected the key (401 Unauthorized)')
  expect(mock.callsTo('POST', '/api/setup/key')[0]?.body).toEqual({
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
  })
  expect(key.value).toBe('  sk-ant-test  ')

  fireEvent.click(save)
  expect(await screen.findByText('Anthropic key validated and saved.')).toBeDefined()
  expect(key.value).toBe('')
  expect(await screen.findByRole('button', { name: 'Remove Anthropic key' })).toBeDefined()
  expect(screen.getByText('Anthropic', { selector: 'span' })).toBeDefined()
  expect(mock.callsTo('POST', '/api/setup/key')).toHaveLength(2)
})

it('explains the file fallback when the keychain is unavailable', async () => {
  installMockApi({ 'GET /api/setup/status': setupStatus({ secrets: { backend: 'file' } }) })
  renderAt('/setup')
  expect(
    await screen.findByText("Keychain unavailable — key stored in a 0600 file in coja's data dir."),
  ).toBeDefined()
})

it('"Skip AI for now" marks setup complete and lands on Projects', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus({ setupComplete: false }),
    'POST /api/setup/complete': setupStatus({ setupComplete: true }),
    'GET /api/projects': [],
  })
  renderAt('/')
  await screen.findByRole('heading', { name: 'Set up coja' })
  expect(currentPath()).toBe('/setup')

  fireEvent.click(screen.getByRole('button', { name: 'Skip AI for now' }))
  expect(await screen.findByRole('heading', { name: 'Projects' })).toBeDefined()
  expect(currentPath()).toBe('/')
  expect(mock.callsTo('POST', '/api/setup/complete')).toHaveLength(1)
  // The completion response seeded the cache: no second status request was needed.
  expect(mock.callsTo('GET', '/api/setup/status')).toHaveLength(1)
})

it('"Continue" also completes setup', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus({ setupComplete: false }),
    'POST /api/setup/complete': setupStatus({ setupComplete: true }),
    'GET /api/projects': [],
  })
  renderAt('/setup')
  await screen.findByRole('heading', { name: 'Set up coja' })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('heading', { name: 'Projects' })).toBeDefined()
  expect(mock.callsTo('POST', '/api/setup/complete')).toHaveLength(1)
})
