import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { ChatGptConnection } from '../codex/connection.js'
import { freePort } from '../codex/oauth.test.js'
import { CODEX_PROTOCOL, type CodexProtocol } from '../codex/protocol.js'
import { openDb, settings } from '../db.js'
import { MemorySecretStore } from '../secrets/store.js'
import {
  API_ROUTES,
  type ApiError,
  type GhAuthStatus,
  type ModelInfo,
  type SetupStatus,
} from '../shared/api.js'
import { onApiError } from './http.js'
import { registerSetupRoutes, SETUP_COMPLETE_KEY } from './setup.js'

function makeApp(opts: { chatgpt?: ChatGptConnection; fetchImpl?: typeof fetch } = {}) {
  const app = new Hono()
  app.onError(onApiError)
  const db = openDb(':memory:')
  const secrets = new MemorySecretStore()
  const ghAuthStatus = vi.fn(
    async (): Promise<GhAuthStatus> => ({ ok: true, login: 'octocat', host: 'github.com' }),
  )
  registerSetupRoutes(
    app,
    { dataDir: '/nowhere', db },
    {
      secrets,
      ghAuthStatus,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.chatgpt ? { chatgpt: opts.chatgpt } : {}),
    },
  )

  const getStatus = async () => {
    const res = await app.request(API_ROUTES.setupStatus)
    expect(res.status).toBe(200)
    return (await res.json()) as SetupStatus
  }
  const getModels = async () => {
    const res = await app.request(API_ROUTES.aiModels)
    expect(res.status).toBe(200)
    return (await res.json()) as ModelInfo[]
  }

  const postCustomProvider = (body: unknown) =>
    app.request(API_ROUTES.setupCustomProviders, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const deleteCustomProvider = (id: string) =>
    app.request(API_ROUTES.setupCustomProviderDelete(id), { method: 'DELETE' })
  const fetchCustomModels = (body: unknown) =>
    app.request(API_ROUTES.setupCustomModels, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  return {
    app,
    db,
    secrets,
    ghAuthStatus,
    getStatus,
    getModels,
    postCustomProvider,
    deleteCustomProvider,
    fetchCustomModels,
  }
}

describe('GET /api/setup/status', () => {
  it('starts provider key checks while the GitHub status request is still pending', async () => {
    const t = makeApp()
    await t.postCustomProvider({
      name: 'Local',
      baseUrl: 'http://localhost:11434/v1',
      apiFormat: 'openai',
      models: ['test'],
    })
    let finish!: (status: GhAuthStatus) => void
    t.ghAuthStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const keys = vi.spyOn(t.secrets, 'get')
    const pending = t.getStatus()
    try {
      await vi.waitFor(() => expect(keys).toHaveBeenCalled())
    } finally {
      finish({ ok: true, login: 'octocat', host: 'github.com' })
    }
    expect((await pending).customProviders).toHaveLength(1)
  })
  it('reports gh, the secrets backend and an incomplete setup', async () => {
    const t = makeApp()
    expect(await t.getStatus()).toEqual({
      gh: { ok: true, login: 'octocat', host: 'github.com' },
      customProviders: [],
      secrets: { backend: 'keychain' },
      setupComplete: false,
      chatgpt: { connected: false },
    })
    expect(t.ghAuthStatus).toHaveBeenCalledTimes(1)
  })

  it('passes through a failed gh status without failing the response', async () => {
    const t = makeApp()
    t.ghAuthStatus.mockResolvedValueOnce({ ok: false, error: 'Not logged in to GitHub.' })
    expect((await t.getStatus()).gh).toEqual({ ok: false, error: 'Not logged in to GitHub.' })
  })

  it('still answers 200 when the gh check itself throws', async () => {
    const t = makeApp()
    t.ghAuthStatus.mockRejectedValueOnce(new Error('spawn gh EACCES'))
    const status = await t.getStatus()
    expect(status.gh.ok).toBe(false)
    expect(status.gh.error).toContain('spawn gh EACCES')
  })

  it('reflects the file backend when the keychain is unavailable', async () => {
    const app = new Hono()
    app.onError(onApiError)
    const secrets = new MemorySecretStore('file')
    registerSetupRoutes(
      app,
      { dataDir: '/nowhere', db: openDb(':memory:') },
      { secrets, ghAuthStatus: async () => ({ ok: false, error: 'no gh' }) },
    )
    const status = (await (await app.request(API_ROUTES.setupStatus)).json()) as SetupStatus
    expect(status.secrets).toEqual({ backend: 'file' })
  })
})

describe('POST /api/setup/complete', () => {
  it('marks the AI step done and returns the status', async () => {
    const t = makeApp()
    expect((await t.getStatus()).setupComplete).toBe(false)
    const res = await t.app.request(API_ROUTES.setupComplete, { method: 'POST' })
    expect(res.status).toBe(200)
    const status = (await res.json()) as SetupStatus
    expect(status.setupComplete).toBe(true)
    expect(status.gh.ok).toBe(true)
    expect(settings.get(t.db, SETUP_COMPLETE_KEY)).toBe('1')
    expect((await t.getStatus()).setupComplete).toBe(true)
  })
})

describe('GET /api/ai/models', () => {
  it('is empty when nothing is configured', async () => {
    const t = makeApp()
    expect(await t.getModels()).toEqual([])
  })

  it('lists custom provider models with the provider display name', async () => {
    const t = makeApp()
    await t.postCustomProvider({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiFormat: 'openai',
      models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner', label: 'DeepSeek R' }],
    })
    const models = await t.getModels()
    expect(models.map((m) => m.id)).toEqual([
      'custom-deepseek:deepseek-chat',
      'custom-deepseek:deepseek-reasoner',
    ])
    // The display name from the endpoint wins over the fallback label.
    expect(models[1]?.label).toBe('DeepSeek R')
  })
})
// ---------------------------------------------------------------------------
// ChatGPT subscription
// ---------------------------------------------------------------------------

const ID_TOKEN = (() => {
  const payload = Buffer.from(
    JSON.stringify({
      email: 'user@example.com',
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1', chatgpt_plan_type: 'plus' },
    }),
  ).toString('base64url')
  return `h.${payload}.s`
})()

/** A real connection against a mocked token endpoint and a free callback port. */
async function makeChatGpt(): Promise<{
  connection: ChatGptConnection
  secrets: MemorySecretStore
  protocol: CodexProtocol
  opened: string[]
}> {
  const secrets = new MemorySecretStore()
  const protocol: CodexProtocol = { ...CODEX_PROTOCOL, redirectPort: await freePort() }
  const CATALOG = {
    models: [
      {
        slug: 'gpt-reserve',
        display_name: 'GPT-Reserve',
        visibility: 'hide',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'low' }],
      },
      {
        slug: 'gpt-5.6-sol',
        display_name: 'GPT-5.6-Sol',
        visibility: 'list',
        default_reasoning_level: 'low',
        supported_reasoning_levels: [
          { effort: 'low', description: 'Fast' },
          { effort: 'ultra', description: 'Deepest' },
        ],
      },
      {
        slug: 'gpt-5.4-mini',
        display_name: 'GPT-5.4-Mini',
        visibility: 'list',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
      },
    ],
  }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('https://auth.openai.com/oauth/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'at-1',
          refresh_token: 'rt-1',
          id_token: ID_TOKEN,
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/models')) {
      return new Response(JSON.stringify(CATALOG), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
  const opened: string[] = []
  const connection = new ChatGptConnection({
    secrets,
    fetchImpl,
    protocol,
    openBrowser: (url) => opened.push(url), // never open a real browser from tests
  })
  return { connection, secrets, protocol, opened }
}

describe('ChatGPT subscription routes', () => {
  const status = async (app: Hono): Promise<SetupStatus> => {
    const res = await app.request(API_ROUTES.setupStatus)
    expect(res.status).toBe(200)
    return (await res.json()) as SetupStatus
  }

  it('reports the connection in the status, with account facts only', async () => {
    const { connection } = await makeChatGpt()
    const t = makeApp({ chatgpt: connection })
    expect((await t.getStatus()).chatgpt).toEqual({ connected: false })
    expect(JSON.stringify(await t.getStatus())).not.toContain('at-1')
  })

  it('connect starts the flow (and surfaces port errors as 400)', async () => {
    const { connection, protocol } = await makeChatGpt()
    const t = makeApp({ chatgpt: connection })
    const res = await t.app.request(API_ROUTES.setupChatgptConnect, { method: 'POST' })
    expect(res.status).toBe(200)
    const { authUrl } = (await res.json()) as { ok: true; authUrl: string }
    expect(authUrl).toContain('auth.openai.com/oauth/authorize')
    expect(authUrl).toContain(`redirect_uri=http%3A%2F%2Flocalhost%3A${protocol.redirectPort}`)

    // A concurrent start is idempotent: the same flow, the same URL.
    const again = await t.app.request(API_ROUTES.setupChatgptConnect, { method: 'POST' })
    expect(((await again.json()) as { authUrl: string }).authUrl).toBe(authUrl)

    // Live status during the flow.
    const live = await t.app.request(API_ROUTES.setupChatgptStatus)
    expect(((await live.json()) as { status: string }).status).toBe('connecting')

    // Simulate the browser callback, then the status flips to connected.
    const state = new URL(authUrl).searchParams.get('state') ?? ''
    await fetch(`http://127.0.0.1:${protocol.redirectPort}/auth/callback?code=good&state=${state}`)
    await vi.waitFor(async () => {
      const done = await t.app.request(API_ROUTES.setupChatgptStatus)
      const body = (await done.json()) as { status: string; email?: string; plan?: string }
      expect(body.status).toBe('connected')
      expect(body.email).toBe('user@example.com')
      expect(body.plan).toBe('plus')
    })
    expect(JSON.stringify(await status(t.app))).not.toContain('rt-1')
  })

  it('connect answers 400 with the setup-safe error when the port is busy', async () => {
    const { connection, protocol } = await makeChatGpt()
    const { createServer } = await import('node:http')
    const occupant = createServer()
    await new Promise<void>((resolve) =>
      occupant.listen(protocol.redirectPort, '127.0.0.1', resolve),
    )
    try {
      const t = makeApp({ chatgpt: connection })
      const res = await t.app.request(API_ROUTES.setupChatgptConnect, { method: 'POST' })
      expect(res.status).toBe(400)
      const err = (await res.json()) as ApiError
      expect(err.code).toBe('provider')
      expect(err.error).toContain('already in use')
      expect(err.error).not.toContain('[coja:chatgpt')
      // The failure also shows up in the polled status.
      const live = (await (await t.app.request(API_ROUTES.setupChatgptStatus)).json()) as {
        status: string
        connectError?: string
      }
      expect(live.connectError).toContain('already in use')
    } finally {
      await new Promise<void>((resolve) => occupant.close(() => resolve()))
    }
  })

  it('disconnect forgets the connection', async () => {
    const { connection, protocol, secrets } = await makeChatGpt()
    const t = makeApp({ chatgpt: connection })
    const started = await t.app.request(API_ROUTES.setupChatgptConnect, { method: 'POST' })
    const authUrl = ((await started.json()) as { authUrl: string }).authUrl
    const state = new URL(authUrl).searchParams.get('state') ?? ''
    await fetch(`http://127.0.0.1:${protocol.redirectPort}/auth/callback?code=good&state=${state}`)
    await vi.waitFor(async () => {
      expect((await status(t.app)).chatgpt.connected).toBe(true)
    })

    const del = await t.app.request(API_ROUTES.setupChatgptDisconnect, { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(await del.json()).toEqual({ ok: true })
    expect(await secrets.get('chatgpt-auth')).toBeNull()
    expect((await status(t.app)).chatgpt.connected).toBe(false)
  })

  it('models include the subscription list only while connected, without network calls', async () => {
    const { connection, protocol } = await makeChatGpt()
    const t = makeApp({ chatgpt: connection })
    expect((await t.getModels()).filter((m) => m.provider === 'chatgpt')).toEqual([])

    const started = await t.app.request(API_ROUTES.setupChatgptConnect, { method: 'POST' })
    const authUrl = ((await started.json()) as { authUrl: string }).authUrl
    const state = new URL(authUrl).searchParams.get('state') ?? ''
    await fetch(`http://127.0.0.1:${protocol.redirectPort}/auth/callback?code=good&state=${state}`)
    await vi.waitFor(async () => {
      expect((await status(t.app)).chatgpt.connected).toBe(true)
    })

    const models = await t.getModels()
    const chatgptModels = models.filter((m) => m.provider === 'chatgpt')
    // Catalog-driven: hidden models filtered, display names, per-model efforts.
    expect(chatgptModels).toEqual([
      {
        id: 'chatgpt:gpt-5.6-sol',
        provider: 'chatgpt',
        modelId: 'gpt-5.6-sol',
        label: 'GPT-5.6-Sol',
        reasoningEfforts: [
          { effort: 'low', description: 'Fast' },
          { effort: 'ultra', description: 'Deepest' },
        ],
        defaultReasoningEffort: 'low',
      },
      {
        id: 'chatgpt:gpt-5.4-mini',
        provider: 'chatgpt',
        modelId: 'gpt-5.4-mini',
        label: 'GPT-5.4-Mini',
        reasoningEfforts: [{ effort: 'low' }, { effort: 'medium' }],
        defaultReasoningEffort: 'medium',
      },
    ])
  })
})

describe('custom model providers', () => {
  const BODY = {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiFormat: 'openai',
    models: [{ id: 'deepseek-chat' }],
    apiKey: 'sk-custom',
  }

  it('adds a provider, lists it in status with hasKey, and serves its models', async () => {
    const t = makeApp()
    const res = await t.postCustomProvider(BODY)
    expect(res.status).toBe(200)
    const { customProviders } = (await res.json()) as SetupStatus
    expect(customProviders).toEqual([
      {
        id: 'custom-deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiFormat: 'openai',
        models: [{ id: 'deepseek-chat' }],
        hasKey: true,
      },
    ])

    const status = await t.getStatus()
    expect(status.customProviders).toEqual(customProviders)

    const models = await t.getModels()
    expect(models.map((m) => m.id)).toContain('custom-deepseek:deepseek-chat')
    const custom = models.find((m) => m.id === 'custom-deepseek:deepseek-chat')
    expect(custom?.providerLabel).toBe('DeepSeek')
  })

  it('keeps the stored key when an edit arrives without one, and replaces it with one', async () => {
    const t = makeApp()
    await t.postCustomProvider(BODY)
    expect(await t.secrets.get('custom-deepseek-api-key')).toBe('sk-custom')

    // Edit without a key: config changes, key survives.
    await t.postCustomProvider({
      ...BODY,
      models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner', label: 'DeepSeek R' }],
    })
    expect(await t.secrets.get('custom-deepseek-api-key')).toBe('sk-custom')
    const status = await t.getStatus()
    expect(status.customProviders[0]?.models).toEqual([
      { id: 'deepseek-chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R' },
    ])
    expect(status.customProviders[0]?.hasKey).toBe(true)

    // An edit with a new key replaces it.
    await t.postCustomProvider({ ...BODY, apiKey: 'sk-next' })
    expect(await t.secrets.get('custom-deepseek-api-key')).toBe('sk-next')
  })

  it('rejects invalid bodies with a 400 and unknown delete ids with a 404', async () => {
    const t = makeApp()
    expect((await t.postCustomProvider({ ...BODY, baseUrl: 'ftp://x' })).status).toBe(400)
    expect((await t.postCustomProvider({ ...BODY, models: [] })).status).toBe(400)
    expect((await t.deleteCustomProvider('custom-nope')).status).toBe(404)
  })

  it('fetch model list: proxies GET /models with the right auth headers (openai shape)', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    const t = makeApp({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
        return new Response(
          JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }) as typeof fetch,
    })
    const res = await t.fetchCustomModels({
      baseUrl: 'https://api.deepseek.com/v1/',
      apiFormat: 'openai',
      apiKey: 'sk-x',
    })
    expect(res.status).toBe(200)
    const { models } = (await res.json()) as { models: { id: string }[] }
    expect(models.map((m) => m.id)).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(calls[0]?.url).toBe('https://api.deepseek.com/v1/models')
    expect(calls[0]?.headers.authorization).toBe('Bearer sk-x')
  })

  it('fetch model list: anthropic shape and headers, labels kept', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    const t = makeApp({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
        return new Response(
          JSON.stringify({ data: [{ id: 'claude-a', display_name: 'Claude A' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }) as typeof fetch,
    })
    const res = await t.fetchCustomModels({
      baseUrl: 'https://proxy.example.com/v1',
      apiFormat: 'anthropic',
      apiKey: 'sk-ant',
    })
    expect(res.status).toBe(200)
    const { models } = (await res.json()) as { models: { id: string; label?: string }[] }
    expect(models).toEqual([{ id: 'claude-a', label: 'Claude A' }])
    expect(calls[0]?.url).toBe('https://proxy.example.com/v1/models')
    expect(calls[0]?.headers['x-api-key']).toBe('sk-ant')
    expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01')
  })

  it('fetch model list: by provider id uses the stored key; failure is a soft 502', async () => {
    const t = makeApp({
      fetchImpl: (async () => new Response('nope', { status: 404 })) as typeof fetch,
    })
    await t.postCustomProvider({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiFormat: 'openai',
      models: ['deepseek-chat'],
      apiKey: 'sk-stored',
    })
    const res = await t.fetchCustomModels({ id: 'custom-deepseek' })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('HTTP 404')
    expect(body.error).toContain('add models by hand')
  })

  it('fetch model list: 400 when neither id nor base URL is given', async () => {
    const t = makeApp()
    expect((await t.fetchCustomModels({})).status).toBe(400)
  })

  it('removes a provider and its stored key', async () => {
    const t = makeApp()
    await t.postCustomProvider(BODY)
    expect((await t.deleteCustomProvider('custom-deepseek')).status).toBe(200)
    expect(await t.secrets.get('custom-deepseek-api-key')).toBeNull()
    expect((await t.getStatus()).customProviders).toEqual([])
    expect((await t.getModels()).map((m) => m.id)).not.toContain('custom-deepseek:deepseek-chat')
  })
})
