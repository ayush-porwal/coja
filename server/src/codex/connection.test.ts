import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { openDb } from '../db.js'
import { MemorySecretStore } from '../secrets/store.js'
import { CHATGPT_AUTH_KEY, ChatGptConnection } from './connection.js'
import { freePort } from './oauth.test.js'
import { CODEX_PROTOCOL, type CodexProtocol } from './protocol.js'

const ID_TOKEN = (email: string): string => {
  const payload = Buffer.from(
    JSON.stringify({
      email,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1', chatgpt_plan_type: 'plus' },
    }),
  ).toString('base64url')
  return `h.${payload}.s`
}

const tokenBody = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    access_token: 'at-1',
    refresh_token: 'rt-1',
    id_token: ID_TOKEN('user@example.com'),
    expires_in: 3600,
    ...overrides,
  })

interface TokenEndpoint {
  fetch: typeof fetch
  /** Number of token-endpoint requests so far (the exchange included). */
  calls: number
  respond: (callNumber: number) => Response
}

function makeConnection(opts: { refreshDelayMs?: number } = {}): {
  connection: ChatGptConnection
  secrets: MemorySecretStore
  token: TokenEndpoint
  protocol: CodexProtocol
  opened: string[]
} {
  const secrets = new MemorySecretStore()
  const token: TokenEndpoint = {
    calls: 0,
    respond: () => {
      throw new Error('no response configured')
    },
    fetch: (async (input: string | URL | Request, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.startsWith('https://auth.openai.com/oauth/token')) {
        throw new Error(`unexpected fetch ${url}`)
      }
      token.calls += 1
      if (opts.refreshDelayMs) await new Promise((r) => setTimeout(r, opts.refreshDelayMs))
      return token.respond(token.calls)
    }) as typeof fetch,
  }
  const protocol: CodexProtocol = { ...CODEX_PROTOCOL, redirectPort: -1 }
  // Without this stub every connect() would `open` a real browser tab on the
  // host (regression: the suite used to spam auth.openai.com tabs).
  const opened: string[] = []
  const connection = new ChatGptConnection({
    secrets,
    fetchImpl: token.fetch,
    protocol,
    openBrowser: (url) => opened.push(url),
  })
  return { connection, secrets, token, protocol, opened }
}

const browserFlow = async (
  connection: ChatGptConnection,
  protocol: CodexProtocol,
  email: string,
): Promise<void> => {
  protocol.redirectPort = await freePort()
  const { authUrl } = await connection.connect()
  const state = new URL(authUrl).searchParams.get('state') ?? ''
  const res = await fetch(
    `http://127.0.0.1:${protocol.redirectPort}${protocol.redirectPath}?code=good&state=${state}`,
  )
  expect(await res.text()).toContain('connected')
  // Let the completion (token store + status flip) land.
  for (let i = 0; i < 100 && !(await connection.status()).connected; i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
  expect((await connection.status()).connected).toBe(true)
  expect((await connection.status()).email).toBe(email)
}

describe('connect / status / disconnect', () => {
  it('persists the record on completion and reports account facts, never tokens', async () => {
    const { connection, secrets, token, protocol, opened } = makeConnection()
    token.respond = () => new Response(tokenBody(), { status: 200 })
    expect(await connection.status()).toEqual({ connected: false, signingIn: false })

    await browserFlow(connection, protocol, 'user@example.com')
    // The flow opened the authorize page exactly once — with the stubbed
    // opener, never the host's real browser.
    expect(opened).toHaveLength(1)
    expect(opened[0]).toContain('auth.openai.com/oauth/authorize')

    const stored = JSON.parse((await secrets.get(CHATGPT_AUTH_KEY)) ?? '{}') as Record<
      string,
      unknown
    >
    expect(stored.accessToken).toBe('at-1')
    expect(stored.refreshToken).toBe('rt-1')
    expect(stored.planType).toBe('plus')

    const status = await connection.status()
    expect(status).toEqual({
      connected: true,
      signingIn: false,
      email: 'user@example.com',
      plan: 'plus',
    })
    // The status object never carries token material.
    expect(JSON.stringify(status)).not.toContain('at-1')

    await connection.disconnect()
    expect(await secrets.get(CHATGPT_AUTH_KEY)).toBeNull()
    expect(await connection.status()).toEqual({ connected: false, signingIn: false })
  })

  it('exposes connect errors of a failed flow through status', async () => {
    const { connection, protocol } = makeConnection()
    // Occupied callback port -> connect() rejects and remembers why.
    protocol.redirectPort = await freePort()
    const occupant = createServer()
    await new Promise<void>((resolve) =>
      occupant.listen(protocol.redirectPort, '127.0.0.1', resolve),
    )
    try {
      await expect(connection.connect()).rejects.toMatchObject({ code: 'transport' })
      const status = await connection.status()
      expect(status.connected).toBe(false)
      expect(status.connectError).toMatch(/port .* is already in use/)
    } finally {
      await new Promise<void>((resolve) => occupant.close(() => resolve()))
    }
  })
})

describe('token refresh', () => {
  it('returns the stored token while fresh and refreshes inside the margin', async () => {
    const { connection, token, protocol } = makeConnection()
    token.respond = (call) =>
      new Response(call === 1 ? tokenBody() : tokenBody({ access_token: 'at-fresh' }), {
        status: 200,
      })
    await browserFlow(connection, protocol, 'user@example.com')
    expect(token.calls).toBe(1) // the flow's exchange
    // 3600 s expiry vs the default 120 s margin: still fresh, no refresh call.
    expect(await connection.getFreshAccessToken()).toEqual({
      accessToken: 'at-1',
      accountId: 'acct-1',
    })
    expect(token.calls).toBe(1)

    const refreshed = await connection.forceRefresh()
    expect(refreshed.accessToken).toBe('at-fresh')
    expect(token.calls).toBe(2)
    expect((await connection.getFreshAccessToken()).accessToken).toBe('at-fresh')
    expect(token.calls).toBe(2)
  })

  it('joins concurrent refreshes into one HTTP call', async () => {
    const { connection, token, protocol } = makeConnection({ refreshDelayMs: 50 })
    let n = 0
    token.respond = () => {
      n += 1
      return new Response(tokenBody({ access_token: `at-${n}`, refresh_token: undefined }), {
        status: 200,
      })
    }
    await browserFlow(connection, protocol, 'user@example.com')
    // The flow record (3600 s) is in the future; forceRefresh ignores the margin.
    const [a, b, c] = await Promise.all([
      connection.forceRefresh(),
      connection.forceRefresh(),
      connection.forceRefresh(),
    ])
    expect(a.accessToken).toBe('at-2')
    expect(b.accessToken).toBe('at-2')
    expect(c.accessToken).toBe('at-2')
    expect(token.calls).toBe(2) // the exchange + exactly one refresh
  })

  it('keeps the old refresh token when the response omits one', async () => {
    const { connection, secrets, token, protocol } = makeConnection()
    token.respond = (call) =>
      new Response(
        call === 1 ? tokenBody() : tokenBody({ access_token: 'at-2', refresh_token: undefined }),
        { status: 200 },
      )
    await browserFlow(connection, protocol, 'user@example.com')
    await connection.forceRefresh()
    expect(JSON.parse((await secrets.get(CHATGPT_AUTH_KEY)) ?? '{}').refreshToken).toBe('rt-1')
    expect(JSON.parse((await secrets.get(CHATGPT_AUTH_KEY)) ?? '{}').accessToken).toBe('at-2')
  })

  it('marks auth-expired on a terminal refresh failure and fails fast afterwards', async () => {
    const { connection, token, protocol } = makeConnection()
    // A 30-minute margin makes the 3600 s record stale, so reads take the refresh path.
    protocol.refreshMarginMs = 90 * 60 * 1000
    token.respond = (call) =>
      new Response(call === 1 ? tokenBody() : JSON.stringify({ error: 'invalid_grant' }), {
        status: call === 1 ? 200 : 400,
      })
    await browserFlow(connection, protocol, 'user@example.com')

    await expect(connection.getFreshAccessToken()).rejects.toMatchObject({ code: 'auth_expired' })
    expect(token.calls).toBe(2)
    expect((await connection.status()).authExpired).toBe(true)

    // Fails fast without network: no further token-endpoint calls.
    await expect(connection.forceRefresh()).rejects.toMatchObject({ code: 'auth_expired' })
    expect(token.calls).toBe(2)
    await expect(connection.getFreshAccessToken()).rejects.toMatchObject({ code: 'auth_expired' })
    expect(token.calls).toBe(2)

    // Transient failures do NOT quarantine: a 500 just errors once.
    const { connection: retryable, token: retryToken, protocol: retryProtocol } = makeConnection()
    retryProtocol.refreshMarginMs = 90 * 60 * 1000
    retryToken.respond = (call) =>
      new Response(call === 1 ? tokenBody() : 'boom', { status: call === 1 ? 200 : 500 })
    await browserFlow(retryable, retryProtocol, 'user@example.com')
    await expect(retryable.getFreshAccessToken()).rejects.toMatchObject({ code: 'transport' })
    expect((await retryable.status()).authExpired).toBeUndefined()
  })

  it('recovers auth-expiry by reconnecting (a fresh login clears the flag)', async () => {
    const { connection, token, protocol } = makeConnection()
    protocol.refreshMarginMs = 90 * 60 * 1000
    token.respond = (call) =>
      call === 2
        ? new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
        : new Response(tokenBody({ access_token: `at-${call}` }), { status: 200 })
    await browserFlow(connection, protocol, 'user@example.com')
    await expect(connection.getFreshAccessToken()).rejects.toMatchObject({ code: 'auth_expired' })

    await browserFlow(connection, protocol, 'user@example.com')
    expect((await connection.getFreshAccessToken()).accessToken).toBe('at-4') // stale record: the read refreshes again
    expect((await connection.status()).authExpired).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

const CATALOG_BODY = {
  models: [
    {
      slug: 'gpt-reserve',
      display_name: 'GPT-Reserve',
      visibility: 'hide',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
    },
    {
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6-Sol',
      visibility: 'list',
      default_reasoning_level: 'low',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'ultra' }],
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

function makeCatalogConnection(
  opts: { catalog?: unknown; catalogFails?: boolean; db?: ReturnType<typeof openDb> } = {},
): {
  connection: ChatGptConnection
  secrets: MemorySecretStore
  protocol: CodexProtocol
  requests: string[]
  db: ReturnType<typeof openDb>
  opened: string[]
} {
  const secrets = new MemorySecretStore()
  const db = opts.db ?? openDb(':memory:')
  const requests: string[] = []
  const protocol: CodexProtocol = { ...CODEX_PROTOCOL, redirectPort: -1 }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests.push(url)
    if (url.includes('/oauth/token')) {
      return new Response(tokenBody(), { status: 200 })
    }
    if (url.includes('/models')) {
      if (opts.catalogFails) return new Response('{"error":"moved"}', { status: 404 })
      return new Response(JSON.stringify(opts.catalog ?? CATALOG_BODY), { status: 200 })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
  const opened: string[] = []
  const connection = new ChatGptConnection({
    secrets,
    db,
    fetchImpl,
    protocol,
    openBrowser: (url) => opened.push(url),
  })
  return { connection, secrets, protocol, requests, db, opened }
}

describe('model catalog', () => {
  it('serves catalog-driven models from cache and answers effort lookups', async () => {
    const { connection, protocol, requests } = makeCatalogConnection()
    await browserFlow(connection, protocol, 'user@example.com')
    requests.length = 0

    const models = await connection.listModels()
    expect(models.map((m) => m.slug)).toEqual(['gpt-5.6-sol', 'gpt-5.4-mini']) // hidden ones filtered
    expect(models[0]?.defaultReasoningEffort).toBe('low')
    expect(connection.defaultReasoningEffortFor('gpt-5.6-sol')).toBe('low')
    expect(connection.defaultReasoningEffortFor('unknown')).toBeUndefined()
    expect(await connection.supportsReasoningEffort('gpt-5.6-sol', 'ultra')).toBe(true)
    expect(await connection.supportsReasoningEffort('gpt-5.6-sol', 'max')).toBe(false)

    // TTL: a second call does no additional fetch.
    await connection.listModels()
    expect(requests.filter((url) => url.includes('/models'))).toHaveLength(1)
  })

  it('falls back to the settings mirror when the catalog endpoint fails', async () => {
    const { connection, protocol, db } = makeCatalogConnection()
    await browserFlow(connection, protocol, 'user@example.com')
    await connection.listModels() // success, mirror written

    // A second connection sharing the same DB survives a catalog outage via the mirror.
    const { connection: broken, protocol: brokenProtocol } = makeCatalogConnection({
      catalogFails: true,
      db,
    })
    await browserFlow(broken, brokenProtocol, 'user@example.com')
    const mirrored = await broken.listModels()
    expect(mirrored.map((m) => m.slug)).toEqual(['gpt-5.6-sol', 'gpt-5.4-mini'])
  })

  it('throws when there is no catalog and no mirror', async () => {
    const { connection, protocol } = makeCatalogConnection({ catalogFails: true })
    await browserFlow(connection, protocol, 'user@example.com')
    await expect(connection.listModels()).rejects.toMatchObject({ code: 'endpoint_changed' })
  })
})
