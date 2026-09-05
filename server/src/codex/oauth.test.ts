import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexError, redact } from './errors.js'
import {
  challengeFor,
  decodeJwtPayload,
  exchangeCode,
  extractMetadata,
  generatePkce,
  refreshAccessToken,
  startBrowserFlow,
} from './oauth.js'
import { CODEX_PROTOCOL, type CodexProtocol } from './protocol.js'

const TOKENS = {
  access_token: 'at.abc.def',
  refresh_token: 'rt.abc',
  id_token: jwt({
    email: 'user@example.com',
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1', chatgpt_plan_type: 'plus' },
  }),
  expires_in: 3600,
}

/** Minimal unsigned JWT with the given payload, as the parser expects. */
function jwt(payload: Record<string, unknown>): string {
  const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${enc({ alg: 'none' })}.${enc(payload)}.sig`
}

/** A free loopback port for the callback listener. */
export async function freePort(): Promise<number> {
  const server: Server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

describe('PKCE', () => {
  it('derives the S256 challenge per the spec vector', async () => {
    // RFC 7636 appendix B vector, also in the ChatGPT OAuth protocol doc.
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
    const { verifier, challenge } = await generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{80,120}$/)
    expect(challenge).toBe(challengeFor(verifier))
  })
})

describe('JWT metadata', () => {
  it('prefers the namespaced claims of the id token and falls back to the access token', () => {
    expect(extractMetadata(TOKENS)).toEqual({
      accountId: 'acct-1',
      planType: 'plus',
      email: 'user@example.com',
    })
    const fallback = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-2' } })
    expect(extractMetadata({ access_token: fallback })).toEqual({ accountId: 'acct-2' })
    expect(extractMetadata({ access_token: 'not-a-jwt' })).toEqual({})
  })

  it('decodes payloads and survives malformed tokens', () => {
    expect(decodeJwtPayload(TOKENS.id_token)?.email).toBe('user@example.com')
    expect(decodeJwtPayload('a.b')).toBeUndefined()
    expect(decodeJwtPayload('a.!!!.c')).toBeUndefined()
  })
})

describe('token endpoint', () => {
  const protocol = CODEX_PROTOCOL

  it('exchanges the code with PKCE and no client secret', async () => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body) })
      return new Response(JSON.stringify(TOKENS), { status: 200 })
    }) as typeof fetch
    const tokens = await exchangeCode({ fetchImpl, protocol }, 'the-code', 'the-verifier')
    expect(tokens.access_token).toBe('at.abc.def')
    const body = new URLSearchParams(calls[0]?.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_id')).toBe(protocol.clientId)
    expect(body.get('code')).toBe('the-code')
    expect(body.get('code_verifier')).toBe('the-verifier')
    expect(body.get('redirect_uri')).toBe(
      `http://localhost:${protocol.redirectPort}${protocol.redirectPath}`,
    )
    expect(calls[0]?.body).not.toContain('client_secret')
  })

  it.each([
    ['invalid_grant', 400, { error: 'invalid_grant' }],
    ['bare 401', 401, {}],
    ['bare 403', 403, {}],
  ])('classifies %s as auth_expired', async (_name, status, body) => {
    const fetchImpl = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
    await expect(refreshAccessToken({ fetchImpl, protocol }, 'rt')).rejects.toMatchObject({
      name: 'CodexError',
      code: 'auth_expired',
    })
  })

  it('never classifies 429/5xx/network as auth_expired', async () => {
    const fetchImpl = (async () =>
      new Response('{"error":"rate limited"}', { status: 429 })) as typeof fetch
    await expect(refreshAccessToken({ fetchImpl, protocol }, 'rt')).rejects.toMatchObject({
      code: 'transport',
    })
    const fiveHundred = (async () => new Response('boom', { status: 502 })) as typeof fetch
    await expect(
      refreshAccessToken({ fetchImpl: fiveHundred, protocol }, 'rt'),
    ).rejects.toMatchObject({
      code: 'transport',
    })
    const offline = (async () => {
      throw new Error('fetch failed')
    }) as typeof fetch
    await expect(refreshAccessToken({ fetchImpl: offline, protocol }, 'rt')).rejects.toMatchObject({
      code: 'transport',
    })
  })
})

describe('browser flow', () => {
  const realFetch = fetch
  const servers: Server[] = []

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  const makeProtocol = async (): Promise<CodexProtocol> => ({
    ...CODEX_PROTOCOL,
    redirectPort: await freePort(),
    authTimeoutMs: 2000,
  })

  /** Mocks only the issuer's token endpoint; everything else goes to the real loopback fetch. */
  const fakeTokenEndpoint = (
    respond: () => Response,
  ): { fetch: typeof fetch; calls: { url: string; body: string }[] } => {
    const calls: { url: string; body: string }[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('https://auth.openai.com/oauth/token')) {
        calls.push({ url, body: String(init?.body) })
        return respond()
      }
      return realFetch(input, init)
    }) as typeof fetch
    return { fetch: fetchImpl, calls }
  }

  it('completes: authorize URL, state-checked callback, PKCE exchange', async () => {
    const protocol = await makeProtocol()
    const token = fakeTokenEndpoint(() => new Response(JSON.stringify(TOKENS), { status: 200 }))
    let opened: string | undefined
    const flow = await startBrowserFlow({
      protocol,
      fetchImpl: token.fetch,
      openBrowser: (url) => {
        opened = url
      },
    })
    expect(opened).toBe(flow.authUrl)
    const authorize = new URL(flow.authUrl)
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${protocol.issuer}/oauth/authorize`)
    expect(authorize.searchParams.get('client_id')).toBe(protocol.clientId)
    expect(authorize.searchParams.get('response_type')).toBe('code')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('scope')).toBe(protocol.scope)
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      `http://localhost:${protocol.redirectPort}${protocol.redirectPath}`,
    )
    expect(authorize.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    const state = authorize.searchParams.get('state') ?? ''
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    // The "browser": a wrong state must be rejected before anything is exchanged.
    // Attach the rejection handler first so the rejection is never unhandled.
    const wrongState = expect(flow.completion).rejects.toMatchObject({ code: 'state_mismatch' })
    const wrong = await realFetch(
      `http://127.0.0.1:${protocol.redirectPort}${protocol.redirectPath}?code=x&state=nope`,
    )
    expect(wrong.status).toBe(200) // self-contained page, no values interpolated
    await wrongState
    expect(token.calls).toHaveLength(0)

    // A second flow on the same port works after the first listener closed.
    const second = await startBrowserFlow({ protocol, fetchImpl: token.fetch })
    const secondState = new URL(second.authUrl).searchParams.get('state') ?? ''
    const res = await realFetch(
      `http://127.0.0.1:${protocol.redirectPort}${protocol.redirectPath}?code=good-code&state=${secondState}`,
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toContain('connected')
    const tokens = await second.completion
    expect(tokens.access_token).toBe('at.abc.def')
    expect(token.calls).toHaveLength(1)
    const body = new URLSearchParams(token.calls[0]?.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('good-code')
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects when the callback carries an OAuth error, and unknown paths 404', async () => {
    const protocol = await makeProtocol()
    const token = fakeTokenEndpoint(() => new Response(JSON.stringify(TOKENS), { status: 200 }))
    const flow = await startBrowserFlow({ protocol, fetchImpl: token.fetch })
    const notFound = await realFetch(`http://127.0.0.1:${protocol.redirectPort}/other`)
    expect(notFound.status).toBe(404)
    const refused = expect(flow.completion).rejects.toMatchObject({ code: 'transport' })
    await realFetch(
      `http://127.0.0.1:${protocol.redirectPort}${protocol.redirectPath}?error=access_denied`,
    )
    await refused
    expect(token.calls).toHaveLength(0)
  })

  it('times out when the browser never calls back', async () => {
    const protocol = await makeProtocol()
    protocol.authTimeoutMs = 50
    const token = fakeTokenEndpoint(() => new Response(JSON.stringify(TOKENS), { status: 200 }))
    const flow = await startBrowserFlow({ protocol, fetchImpl: token.fetch })
    await expect(flow.completion).rejects.toMatchObject({ code: 'transport' })
  })

  it('reports an occupied callback port as a transport error', async () => {
    const protocol = await makeProtocol()
    const occupant: Server = createServer()
    await new Promise<void>((resolve) =>
      occupant.listen(protocol.redirectPort, '127.0.0.1', resolve),
    )
    servers.push(occupant)
    const token = fakeTokenEndpoint(() => new Response(JSON.stringify(TOKENS), { status: 200 }))
    await expect(startBrowserFlow({ protocol, fetchImpl: token.fetch })).rejects.toMatchObject({
      code: 'transport',
    })
  })
})

describe('redact', () => {
  it('strips bearer headers and token fields before any truncation could', () => {
    const text = JSON.stringify({
      authorization: 'Bearer sk-secret-token-value',
      access_token: 'at-secret',
      nested: { refresh_token: 'rt-secret' },
    })
    // Caller semantics: redact the whole body, then cut the snippet.
    const out = redact(`POST /token?${'x'.repeat(2_000)} ${text} Bearer at.abc.def`).slice(0, 200)
    expect(out).not.toContain('at-secret')
    expect(out).not.toContain('rt-secret')
    expect(out).not.toContain('sk-secret-token-value')
    expect(out).not.toContain('Bearer at.abc.def')
    expect(out.length).toBeLessThanOrEqual(200)
  })

  it('redacts form bodies', () => {
    const out = redact('grant_type=refresh_token&refresh_token=rt-very-secret&client_id=app_x')
    expect(out).not.toContain('rt-very-secret')
    expect(out).toContain('refresh_token=[REDACTED]')
  })
})

describe('error messages', () => {
  it('carry the stable marker and reviewer-facing text', () => {
    const err = new CodexError('quota', 'HTTP 429')
    expect(err.message).toMatch(/^\[coja:chatgpt:quota\] Your ChatGPT plan limit is reached/)
  })
})
