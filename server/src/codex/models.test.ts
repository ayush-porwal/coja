import { describe, expect, it } from 'vitest'
import { fetchModelCatalog, parseModelCatalog } from './models.js'
import { CODEX_PROTOCOL, type CodexProtocol } from './protocol.js'

/** Shaped after the live `GET /backend-api/codex/models` response (2026-09-05, Plus account). */
const CATALOG = {
  models: [
    {
      slug: 'gpt-reserve',
      display_name: 'GPT-Reserve',
      visibility: 'hide',
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [
        { effort: 'low' },
        { effort: 'medium', description: 'Balanced' },
      ],
    },
    {
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6-Sol',
      description: 'Flagship.',
      visibility: 'list',
      context_window: 272000,
      default_reasoning_level: 'low',
      supported_reasoning_levels: [
        { effort: 'low', description: 'Fast responses with lighter reasoning' },
        { effort: 'medium' },
        { effort: 'ultra', description: 'Slowest and deepest' },
      ],
    },
    {
      slug: 'codex-auto-review',
      display_name: 'Codex Auto Review',
      visibility: 'hide',
    },
    {
      slug: 'gpt-5.4-mini',
      display_name: 'GPT-5.4-Mini',
      visibility: 'list',
      supported_reasoning_levels: null,
    },
  ],
}

describe('parseModelCatalog', () => {
  it('keeps listed models with efforts and drops hidden plumbing models', () => {
    const models = parseModelCatalog(CATALOG)
    expect(models.map((m) => m.slug)).toEqual(['gpt-5.6-sol', 'gpt-5.4-mini'])
    const sol = models[0] ?? { slug: '', displayName: '', reasoningEfforts: [] }
    expect(sol.displayName).toBe('GPT-5.6-Sol')
    expect(sol.defaultReasoningEffort).toBe('low')
    expect(sol.contextWindow).toBe(272000)
    expect(sol.reasoningEfforts).toEqual([
      { effort: 'low', description: 'Fast responses with lighter reasoning' },
      { effort: 'medium' },
      { effort: 'ultra', description: 'Slowest and deepest' },
    ])
    expect(models[1]?.reasoningEfforts).toEqual([])
    expect(models[1]?.defaultReasoningEffort).toBeUndefined()
  })

  it('refuses a catalog with an unexpected shape', () => {
    expect(() => parseModelCatalog({ models: 'all of them' })).toThrow()
    expect(() => parseModelCatalog({})).toThrow()
  })
})

describe('fetchModelCatalog', () => {
  const protocol: CodexProtocol = CODEX_PROTOCOL

  const fake = (
    handler: (forceRefresh: boolean) => Response,
  ): { fetch: typeof fetch; forced: boolean[] } => {
    const forced: boolean[] = []
    const fetchImpl = (async () => {
      forced.push(false)
      void forced
      return handler(forced.length > 1)
    }) as unknown as typeof fetch
    return { fetch: fetchImpl, forced }
  }

  const tokens = {
    getToken: async () => ({ accessToken: 'tok-1', accountId: 'acct-9' }),
    forceRefresh: async () => ({ accessToken: 'tok-2', accountId: 'acct-9' }),
  }

  it('fetches with subscription headers and the client_version query', async () => {
    let seen: { url: string; auth?: string } = { url: '' }
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      seen = {
        url: String(input),
        auth: (init?.headers as Record<string, string>)?.authorization,
      }
      return new Response(JSON.stringify(CATALOG), { status: 200 })
    }) as typeof fetch
    const models = await fetchModelCatalog({ fetchImpl, protocol, ...tokens })
    expect(models).toHaveLength(2)
    expect(seen.url).toBe('https://chatgpt.com/backend-api/codex/models?client_version=0.144.6')
    expect(seen.auth).toBe('Bearer tok-1')
  })

  it('retries once on 401 through a forced refresh', async () => {
    const { fetch: fetchImpl } = fake((forceRefresh) =>
      forceRefresh
        ? new Response(JSON.stringify(CATALOG), { status: 200 })
        : new Response('{"error":"expired"}', { status: 401 }),
    )
    const models = await fetchModelCatalog({ fetchImpl, protocol, ...tokens })
    expect(models).toHaveLength(2)
  })

  it('maps auth death, quota and drift to typed errors', async () => {
    const dead = (async () => new Response('{"error":"no"}', { status: 401 })) as typeof fetch
    await expect(fetchModelCatalog({ fetchImpl: dead, protocol, ...tokens })).rejects.toMatchObject(
      {
        code: 'auth_expired',
      },
    )
    const limited = (async () => new Response('{}', { status: 429 })) as typeof fetch
    await expect(
      fetchModelCatalog({ fetchImpl: limited, protocol, ...tokens }),
    ).rejects.toMatchObject({
      code: 'quota',
    })
    const moved = (async () => new Response('<html>gone</html>', { status: 404 })) as typeof fetch
    await expect(
      fetchModelCatalog({ fetchImpl: moved, protocol, ...tokens }),
    ).rejects.toMatchObject({
      code: 'endpoint_changed',
    })
    const junk = (async () => new Response('{"models":"yes"}', { status: 200 })) as typeof fetch
    await expect(fetchModelCatalog({ fetchImpl: junk, protocol, ...tokens })).rejects.toMatchObject(
      {
        code: 'endpoint_changed',
      },
    )
  })
})
