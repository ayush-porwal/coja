import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { openDb, settings } from '../db.js'
import { MemorySecretStore } from '../secrets/store.js'
import {
  API_ROUTES,
  type ApiError,
  type GhAuthStatus,
  type ModelInfo,
  type SaveKeyRequest,
  type SetupStatus,
} from '../shared/api.js'
import { onApiError } from './http.js'
import { ModelCache, registerSetupRoutes, SETUP_COMPLETE_KEY } from './setup.js'

const GOOD_OPENAI = 'sk-proj-good-0000000000'
const GOOD_ANTHROPIC = 'sk-ant-good-0000000000'
const BAD = 'sk-bad'

const OPENAI_LIST = [{ id: 'gpt-5-mini' }, { id: 'gpt-4o' }, { id: 'gpt-4.1' }]
const ANTHROPIC_LIST = [{ id: 'claude-sonnet-4-5-20250929' }, { id: 'claude-3-haiku-20240307' }]

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * A provider stand-in: 401 for the bad key, otherwise the models list of the
 * provider addressed by the URL. Records every call so tests can count them.
 */
function fakeProviders() {
  const calls: { url: string; key: string | undefined }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const headers = (init?.headers ?? {}) as Record<string, string>
    const key = headers['x-api-key'] ?? headers.authorization?.replace(/^Bearer /, '')
    calls.push({ url, key })
    if (key === BAD) return json(401, { error: { message: 'Incorrect API key' } })
    if (url.startsWith('https://api.openai.com/')) return json(200, { data: OPENAI_LIST })
    if (url.startsWith('https://api.anthropic.com/')) return json(200, { data: ANTHROPIC_LIST })
    return json(404, {})
  }) as typeof fetch
  return { impl, calls }
}

function makeApp(opts: { now?: () => number } = {}) {
  const app = new Hono()
  app.onError(onApiError)
  const db = openDb(':memory:')
  const secrets = new MemorySecretStore()
  const ghAuthStatus = vi.fn(
    async (): Promise<GhAuthStatus> => ({ ok: true, login: 'octocat', host: 'github.com' }),
  )
  const providers = fakeProviders()
  const modelCache = new ModelCache(undefined, opts.now)
  registerSetupRoutes(
    app,
    { dataDir: '/nowhere', db },
    { secrets, ghAuthStatus, fetchImpl: providers.impl, modelCache },
  )

  const getStatus = async () => {
    const res = await app.request(API_ROUTES.setupStatus)
    expect(res.status).toBe(200)
    return (await res.json()) as SetupStatus
  }
  const saveKey = (body: unknown) =>
    app.request(API_ROUTES.setupKey, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const getModels = async () => {
    const res = await app.request(API_ROUTES.aiModels)
    expect(res.status).toBe(200)
    return (await res.json()) as ModelInfo[]
  }

  return { app, db, secrets, ghAuthStatus, providers, modelCache, getStatus, saveKey, getModels }
}

describe('GET /api/setup/status', () => {
  it('reports gh, unconfigured providers, the secrets backend and an incomplete setup', async () => {
    const t = makeApp()
    expect(await t.getStatus()).toEqual({
      gh: { ok: true, login: 'octocat', host: 'github.com' },
      providers: { openai: { configured: false }, anthropic: { configured: false } },
      secrets: { backend: 'keychain' },
      setupComplete: false,
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
    expect(status.providers.openai.configured).toBe(false)
  })

  it('reflects keys already in the store and the file backend', async () => {
    const app = new Hono()
    app.onError(onApiError)
    const secrets = new MemorySecretStore('file')
    await secrets.set('anthropic-api-key', GOOD_ANTHROPIC)
    registerSetupRoutes(
      app,
      { dataDir: '/nowhere', db: openDb(':memory:') },
      { secrets, ghAuthStatus: async () => ({ ok: false, error: 'no gh' }) },
    )
    const status = (await (await app.request(API_ROUTES.setupStatus)).json()) as SetupStatus
    expect(status.providers).toEqual({
      openai: { configured: false },
      anthropic: { configured: true },
    })
    expect(status.secrets.backend).toBe('file')
  })
})

describe('POST /api/setup/key', () => {
  it('validates with the provider, stores the trimmed key and completes setup', async () => {
    const t = makeApp()
    const body: SaveKeyRequest = { provider: 'openai', apiKey: `  ${GOOD_OPENAI}\n` }
    const res = await t.saveKey(body)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: true, provider: 'openai' })
    expect(text).not.toContain(GOOD_OPENAI)

    expect(await t.secrets.get('openai-api-key')).toBe(GOOD_OPENAI)
    expect(t.providers.calls).toEqual([
      { url: 'https://api.openai.com/v1/models', key: GOOD_OPENAI },
    ])

    const status = await t.getStatus()
    expect(status.providers.openai.configured).toBe(true)
    expect(status.providers.anthropic.configured).toBe(false)
    expect(status.setupComplete).toBe(true)
    expect(settings.get(t.db, SETUP_COMPLETE_KEY)).toBe('1')
  })

  it("answers 400 with code 'provider' for a rejected key and stores nothing", async () => {
    const t = makeApp()
    const res = await t.saveKey({ provider: 'anthropic', apiKey: BAD })
    expect(res.status).toBe(400)
    expect((await res.json()) as ApiError).toEqual({
      error: 'That key was rejected by Anthropic.',
      code: 'provider',
    })
    expect(await t.secrets.get('anthropic-api-key')).toBeNull()
    expect((await t.getStatus()).setupComplete).toBe(false)
  })

  it("answers 400 with code 'bad_request' for malformed bodies, without calling the provider", async () => {
    const t = makeApp()
    for (const body of [
      { provider: 'gemini', apiKey: 'x' },
      { provider: 'openai' },
      { provider: 'openai', apiKey: '   ' },
      { apiKey: 'x' },
      'not json',
    ]) {
      const res = await t.saveKey(body)
      expect(res.status).toBe(400)
      const err = (await res.json()) as ApiError
      expect(err.code).toBe('bad_request')
      expect(err.error).toMatch(/invalid request|JSON body/)
    }
    expect(t.providers.calls).toEqual([])
    expect(await t.secrets.get('openai-api-key')).toBeNull()
  })

  it('overwrites an existing key', async () => {
    const t = makeApp()
    await t.saveKey({ provider: 'openai', apiKey: GOOD_OPENAI })
    const res = await t.saveKey({ provider: 'openai', apiKey: `${GOOD_OPENAI}-rotated` })
    expect(res.status).toBe(200)
    expect(await t.secrets.get('openai-api-key')).toBe(`${GOOD_OPENAI}-rotated`)
  })
})

describe('DELETE /api/setup/key', () => {
  it('removes the key and leaves setupComplete alone', async () => {
    const t = makeApp()
    await t.saveKey({ provider: 'openai', apiKey: GOOD_OPENAI })
    const res = await t.app.request(API_ROUTES.setupKeyDelete('openai'), { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await t.secrets.get('openai-api-key')).toBeNull()
    const status = await t.getStatus()
    expect(status.providers.openai.configured).toBe(false)
    expect(status.setupComplete).toBe(true)
  })

  it('is idempotent for a provider without a key', async () => {
    const t = makeApp()
    const res = await t.app.request(API_ROUTES.setupKeyDelete('anthropic'), { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('rejects a missing or unknown provider', async () => {
    const t = makeApp()
    for (const url of ['/api/setup/key', '/api/setup/key?provider=gemini']) {
      const res = await t.app.request(url, { method: 'DELETE' })
      expect(res.status).toBe(400)
      const err = (await res.json()) as ApiError
      expect(err.code).toBe('bad_request')
      expect(err.error).toContain('provider')
    }
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
    expect(status.providers.openai.configured).toBe(false)
    expect(settings.get(t.db, SETUP_COMPLETE_KEY)).toBe('1')
    expect((await t.getStatus()).setupComplete).toBe(true)
  })
})

describe('GET /api/ai/models', () => {
  it('is empty when no provider is configured and does not call any provider', async () => {
    const t = makeApp()
    expect(await t.getModels()).toEqual([])
    expect(t.providers.calls).toEqual([])
  })

  it('lists only configured providers, narrowed to what the key can use', async () => {
    const t = makeApp()
    await t.saveKey({ provider: 'openai', apiKey: GOOD_OPENAI })
    expect((await t.getModels()).map((m) => m.id)).toEqual(['openai:gpt-5-mini', 'openai:gpt-4.1'])

    await t.saveKey({ provider: 'anthropic', apiKey: GOOD_ANTHROPIC })
    const models = await t.getModels()
    expect(models.map((m) => m.id)).toEqual([
      'openai:gpt-5-mini',
      'openai:gpt-4.1',
      'anthropic:claude-sonnet-4-5',
    ])
    expect(models[2]).toEqual({
      id: 'anthropic:claude-sonnet-4-5',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      label: 'Claude Sonnet 4.5',
    })
    const listCalls = t.providers.calls.filter((c) => c.url.includes('limit=1000'))
    expect(listCalls.map((c) => c.key)).toEqual([GOOD_ANTHROPIC])
  })

  it('caches per provider and forgets the cache when a key is saved or deleted', async () => {
    const t = makeApp()
    await t.saveKey({ provider: 'openai', apiKey: GOOD_OPENAI })
    const afterSave = t.providers.calls.length // the validation call
    await t.getModels()
    await t.getModels()
    await t.getModels()
    expect(t.providers.calls.length).toBe(afterSave + 1)

    await t.saveKey({ provider: 'openai', apiKey: `${GOOD_OPENAI}-rotated` })
    await t.getModels()
    expect(t.providers.calls.length).toBe(afterSave + 3) // validation + fresh list

    await t.app.request(API_ROUTES.setupKeyDelete('openai'), { method: 'DELETE' })
    expect(await t.getModels()).toEqual([])
    expect(t.providers.calls.length).toBe(afterSave + 3)
  })

  it('refreshes after the 10-minute TTL', async () => {
    let now = 1_000_000
    const t = makeApp({ now: () => now })
    await t.saveKey({ provider: 'anthropic', apiKey: GOOD_ANTHROPIC })
    const afterSave = t.providers.calls.length
    await t.getModels()
    now += 9 * 60 * 1000
    await t.getModels()
    expect(t.providers.calls.length).toBe(afterSave + 1)
    now += 2 * 60 * 1000
    await t.getModels()
    expect(t.providers.calls.length).toBe(afterSave + 2)
  })
})

describe('ModelCache', () => {
  const model: ModelInfo = {
    id: 'openai:gpt-5',
    provider: 'openai',
    modelId: 'gpt-5',
    label: 'GPT-5',
  }

  it('shares an in-flight load and drops a rejected one', async () => {
    const cache = new ModelCache()
    let resolve!: (models: ModelInfo[]) => void
    const load = vi.fn(() => new Promise<ModelInfo[]>((r) => (resolve = r)))
    const a = cache.getOrLoad('openai', load)
    const b = cache.getOrLoad('openai', load)
    expect(load).toHaveBeenCalledTimes(1)
    resolve([model])
    expect(await a).toEqual([model])
    expect(await b).toEqual([model])

    const failing = vi.fn(() => Promise.reject(new Error('boom')))
    await expect(cache.getOrLoad('anthropic', failing)).rejects.toThrow('boom')
    await expect(cache.getOrLoad('anthropic', failing)).rejects.toThrow('boom')
    expect(failing).toHaveBeenCalledTimes(2)
  })

  it('clears one provider or all', async () => {
    const cache = new ModelCache()
    const load = vi.fn(async () => [model])
    await cache.getOrLoad('openai', load)
    await cache.getOrLoad('anthropic', load)
    cache.clear('openai')
    await cache.getOrLoad('openai', load)
    await cache.getOrLoad('anthropic', load)
    expect(load).toHaveBeenCalledTimes(3)
    cache.clear()
    await cache.getOrLoad('openai', load)
    await cache.getOrLoad('anthropic', load)
    expect(load).toHaveBeenCalledTimes(5)
  })
})
