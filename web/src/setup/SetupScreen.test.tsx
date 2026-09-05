import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { setupStatus } from '../test/fixtures'
import { installMockApi } from '../test/mockApi'
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

  fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
  expect(await screen.findByText('Signed in as', { exact: false })).toBeDefined()
  expect(screen.getByText('octocat')).toBeDefined()
  expect(mock.callsTo('GET', '/api/setup/status')).toHaveLength(2)
  await waitFor(() => expect(cont.disabled).toBe(false))
})

it('Continue without any AI provider marks setup complete and lands on Projects', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus({ setupComplete: false }),
    'POST /api/setup/complete': setupStatus({ setupComplete: true }),
    'GET /api/projects': [],
  })
  renderAt('/')
  await screen.findByRole('heading', { name: 'Set up coja' })
  expect(currentPath()).toBe('/setup')

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
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

it('adds a custom provider: model list gating, payload, configured state', async () => {
  let added: { name: string; models: { id: string }[] } | null = null
  const mock = installMockApi({
    'GET /api/setup/status': () =>
      setupStatus({
        customProviders: added
          ? [
              {
                id: 'custom-deepseek',
                name: 'DeepSeek',
                baseUrl: 'https://api.deepseek.com/v1',
                apiFormat: 'openai',
                models: added.models,
                hasKey: true,
              },
            ]
          : [],
      }),
    'POST /api/setup/custom-providers': ({
      body,
    }: {
      body?: { name: string; models: { id: string }[] }
    }) => {
      added = { name: body?.name ?? '', models: body?.models ?? [] }
      return {
        customProviders: [
          {
            id: 'custom-deepseek',
            name: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com/v1',
            apiFormat: 'openai',
            models: added.models,
            hasKey: true,
          },
        ],
      }
    },
  })
  renderAt('/setup')

  await screen.findByRole('heading', { name: 'Set up coja' })
  fireEvent.click(screen.getByRole('button', { name: 'Add model provider' }))

  // The provider cannot be added without a model.
  expect((screen.getByRole('button', { name: 'Add provider' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  expect(screen.getByText('Add at least one model before adding the provider.')).toBeDefined()

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'DeepSeek' } })
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://api.deepseek.com/v1' },
  })
  fireEvent.change(screen.getByLabelText('Model list'), {
    target: { value: 'deepseek-chat' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }))

  fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
  await waitFor(() => expect(mock.callsTo('POST', '/api/setup/custom-providers')).toHaveLength(1))
  expect(added).toEqual({ name: 'DeepSeek', models: [{ id: 'deepseek-chat' }] })

  // The configured state renders with the endpoint and a Remove action.
  expect(await screen.findByText('https://api.deepseek.com/v1')).toBeDefined()
  expect(screen.getByRole('button', { name: 'Remove DeepSeek' })).toBeDefined()
})

it('rejects a bad base URL inline', async () => {
  installMockApi({ 'GET /api/setup/status': setupStatus({}) })
  renderAt('/setup')
  await screen.findByRole('heading', { name: 'Set up coja' })
  fireEvent.click(screen.getByRole('button', { name: 'Add model provider' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'ftp://x' } })
  fireEvent.change(screen.getByLabelText('Model list'), { target: { value: 'm' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }))
  // invalid URL keeps the submit disabled (Input renders invalid state)
  expect((screen.getByRole('button', { name: 'Add provider' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
})

it('edits a custom provider: pre-filled form, payload keeps fields, blank key omitted', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus({
      customProviders: [
        {
          id: 'custom-deepseek',
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          apiFormat: 'openai',
          models: [{ id: 'deepseek-chat' }],
          hasKey: true,
        },
      ],
    }),
    'POST /api/setup/custom-providers': ({ body }: { body?: { models?: string[] } }) => ({
      customProviders: [
        {
          id: 'custom-deepseek',
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          apiFormat: 'openai',
          models: body?.models ?? [],
          hasKey: true,
        },
      ],
    }),
  })
  renderAt('/setup')

  await screen.findByText('DeepSeek')
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  // Pre-filled with the stored config.
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('DeepSeek')
  expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
    'https://api.deepseek.com/v1',
  )
  expect(screen.getByText(/A key is stored/)).toBeDefined()

  // Add a model and save.
  fireEvent.change(screen.getByLabelText('Model list'), {
    target: { value: 'deepseek-reasoner' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

  await waitFor(() => expect(mock.callsTo('POST', '/api/setup/custom-providers')).toHaveLength(1))
  const body = mock.callsTo('POST', '/api/setup/custom-providers')[0]?.body as {
    models: string[]
    apiKey?: string
  }
  expect(body.models).toEqual([{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }])
  // No key typed: the request must not carry one (the server keeps the stored key).
  expect(body.apiKey).toBeUndefined()
  // The form closed after saving.
  expect(screen.getByRole('button', { name: 'Add model provider' })).toBeDefined()
})

it('fetch model list merges the endpoint models into the editable chips', async () => {
  const mock = installMockApi({
    'GET /api/setup/status': setupStatus({}),
    'POST /api/setup/custom-providers/models': () => ({
      models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
    }),
  })
  renderAt('/setup')
  await screen.findByRole('heading', { name: 'Set up coja' })

  fireEvent.click(screen.getByRole('button', { name: 'Add model provider' }))
  // No base URL yet: the fetch is gated.
  expect(
    (screen.getByRole('button', { name: 'Fetch model list' }) as HTMLButtonElement).disabled,
  ).toBe(true)

  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://api.deepseek.com/v1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Fetch model list' }))

  await waitFor(() =>
    expect(mock.callsTo('POST', '/api/setup/custom-providers/models')).toHaveLength(1),
  )
  expect(await screen.findByText(/Found 2 models/)).toBeDefined()
  expect(screen.getByText('deepseek-chat')).toBeDefined()
  expect(screen.getByText('deepseek-reasoner')).toBeDefined()
  // The fetched list is editable: a chip can be removed again.
  fireEvent.click(screen.getByRole('button', { name: 'Remove model deepseek-reasoner' }))
  expect(screen.queryByText('deepseek-reasoner')).toBeNull()
})
