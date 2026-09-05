import { describe, expect, it } from 'vitest'
import {
  curatedModels,
  listModels,
  matchesCuratedModel,
  PROVIDER_LABELS,
  validateApiKey,
} from './providers.js'

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>

/** A `fetch` stand-in that records calls and answers with `handler`. */
function fakeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    return handler(url, init)
  }) as typeof fetch
  return { impl, calls }
}

const json = (status: number, body: unknown, statusText?: string) =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  })

const headersOf = (init: RequestInit | undefined) => init?.headers as Record<string, string>

const KEY = 'sk-test-SECRET-1234567890'

describe('validateApiKey', () => {
  it('accepts a key OpenAI answers 200 to, using the models list with a bearer token', async () => {
    const f = fakeFetch(() => json(200, { data: [] }))
    expect(await validateApiKey('openai', KEY, f.impl)).toEqual({ ok: true })
    expect(f.calls).toHaveLength(1)
    const call = f.calls[0]
    expect(call?.url).toBe('https://api.openai.com/v1/models')
    expect(call?.init?.method).toBe('GET')
    expect(headersOf(call?.init).authorization).toBe(`Bearer ${KEY}`)
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('accepts a key Anthropic answers 200 to, using x-api-key and the version header', async () => {
    const f = fakeFetch(() => json(200, { data: [] }))
    expect(await validateApiKey('anthropic', KEY, f.impl)).toEqual({ ok: true })
    const call = f.calls[0]
    expect(call?.url).toBe('https://api.anthropic.com/v1/models?limit=1')
    expect(headersOf(call?.init)['x-api-key']).toBe(KEY)
    expect(headersOf(call?.init)['anthropic-version']).toBe('2023-06-01')
    expect(headersOf(call?.init).authorization).toBeUndefined()
  })

  it('reports a rejected key on 401 without echoing the key', async () => {
    const f = fakeFetch(() =>
      json(401, { error: { code: 'invalid_api_key', message: `Incorrect API key ${KEY}` } }),
    )
    const result = await validateApiKey('openai', KEY, f.impl)
    expect(result).toEqual({ ok: false, error: 'That key was rejected by OpenAI.' })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('reports a rejected key on 403', async () => {
    const f = fakeFetch(() => json(403, { type: 'error' }))
    expect(await validateApiKey('anthropic', KEY, f.impl)).toEqual({
      ok: false,
      error: 'That key was rejected by Anthropic.',
    })
  })

  it('names the status for other failures', async () => {
    const f = fakeFetch(() => json(503, { error: 'down' }, 'Service Unavailable'))
    const result = await validateApiKey('openai', KEY, f.impl)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe(
      'OpenAI returned HTTP 503 Service Unavailable while checking the key.',
    )
  })

  it('explains network errors including the underlying cause', async () => {
    const f = fakeFetch(() => {
      throw new TypeError('fetch failed', {
        cause: new Error('getaddrinfo ENOTFOUND api.openai.com'),
      })
    })
    expect(await validateApiKey('openai', KEY, f.impl)).toEqual({
      ok: false,
      error: 'Could not reach OpenAI: fetch failed (getaddrinfo ENOTFOUND api.openai.com)',
    })
  })

  it('times out via the abort signal', async () => {
    const f = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const result = await validateApiKey('anthropic', KEY, f.impl, { timeoutMs: 20 })
    expect(result).toEqual({
      ok: false,
      error: 'Could not reach Anthropic: no response within 0 s',
    })
  })
})

describe('curatedModels', () => {
  it('lists the curated OpenAI models with provider-prefixed ids', () => {
    const models = curatedModels('openai')
    expect(models.map((m) => m.modelId)).toEqual([
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
    ])
    expect(models[0]).toEqual({
      id: 'openai:gpt-5',
      provider: 'openai',
      modelId: 'gpt-5',
      label: 'GPT-5',
    })
    expect(models.every((m) => m.id === `openai:${m.modelId}`)).toBe(true)
  })

  it('lists the curated Anthropic models', () => {
    expect(curatedModels('anthropic')).toEqual([
      {
        id: 'anthropic:claude-sonnet-4-5',
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        label: 'Claude Sonnet 4.5',
      },
      {
        id: 'anthropic:claude-opus-4-1',
        provider: 'anthropic',
        modelId: 'claude-opus-4-1',
        label: 'Claude Opus 4.1',
      },
      {
        id: 'anthropic:claude-haiku-4-5',
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
      },
    ])
  })

  it('has a label for every provider', () => {
    expect(PROVIDER_LABELS).toEqual({ openai: 'OpenAI', anthropic: 'Anthropic' })
  })
})

describe('matchesCuratedModel', () => {
  it('matches the alias itself and dated snapshots of it, nothing else', () => {
    expect(matchesCuratedModel('claude-sonnet-4-5', 'claude-sonnet-4-5')).toBe(true)
    expect(matchesCuratedModel('claude-sonnet-4-5', 'claude-sonnet-4-5-20250929')).toBe(true)
    expect(matchesCuratedModel('gpt-4.1', 'gpt-4.1-2025-04-14')).toBe(true)
    expect(matchesCuratedModel('gpt-5', 'gpt-5-mini')).toBe(false)
    expect(matchesCuratedModel('claude-opus-4', 'claude-opus-4-1-20250805')).toBe(false)
    expect(matchesCuratedModel('gpt-4.1', 'gpt-4.1-mini-2025-04-14')).toBe(false)
    expect(matchesCuratedModel('gpt-5', 'gpt-5.1')).toBe(false)
  })
})

describe('listModels', () => {
  it('returns the curated models the key can use, in curated order', async () => {
    const f = fakeFetch(() =>
      json(200, {
        object: 'list',
        data: [
          { id: 'gpt-4.1-mini' },
          { id: 'gpt-4o' },
          { id: 'gpt-5' },
          { id: 'gpt-4.1-2025-04-14' },
          { id: 'text-embedding-3-small' },
        ],
      }),
    )
    const models = await listModels('openai', KEY, f.impl)
    expect(models.map((m) => m.id)).toEqual([
      'openai:gpt-5',
      'openai:gpt-4.1',
      'openai:gpt-4.1-mini',
    ])
    expect(headersOf(f.calls[0]?.init).authorization).toBe(`Bearer ${KEY}`)
  })

  it("matches Anthropic's dated snapshots against the curated aliases and asks for the whole list", async () => {
    const f = fakeFetch(() =>
      json(200, {
        data: [
          { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
          { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
          { id: 'claude-3-haiku-20240307', display_name: 'Claude Haiku 3' },
        ],
        has_more: false,
      }),
    )
    const models = await listModels('anthropic', KEY, f.impl)
    expect(models.map((m) => m.modelId)).toEqual(['claude-sonnet-4-5', 'claude-haiku-4-5'])
    expect(f.calls[0]?.url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(headersOf(f.calls[0]?.init)['x-api-key']).toBe(KEY)
  })

  it('is empty when the key can reach none of the curated models', async () => {
    const f = fakeFetch(() => json(200, { data: [{ id: 'gpt-3.5-turbo' }] }))
    expect(await listModels('openai', KEY, f.impl)).toEqual([])
  })

  it('falls back to the curated list when the request fails', async () => {
    const network = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    expect(await listModels('openai', KEY, network.impl)).toEqual(curatedModels('openai'))

    const serverError = fakeFetch(() => json(500, { error: 'boom' }))
    expect(await listModels('anthropic', KEY, serverError.impl)).toEqual(curatedModels('anthropic'))

    const malformed = fakeFetch(() => json(200, { models: ['gpt-5'] }))
    expect(await listModels('openai', KEY, malformed.impl)).toEqual(curatedModels('openai'))

    const notJson = fakeFetch(() => new Response('<html>', { status: 200 }))
    expect(await listModels('openai', KEY, notJson.impl)).toEqual(curatedModels('openai'))
  })
})
