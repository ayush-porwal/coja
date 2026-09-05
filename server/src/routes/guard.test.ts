import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { ApiError } from '../shared/api.js'
import { hostnameOf, type RequestGuardOptions, registerRequestGuard } from './guard.js'

type HeaderMap = Record<string, string>

const HOST = '127.0.0.1:4321'
const ORIGIN = 'http://127.0.0.1:4321'
const BODY = '{"a":1}'
const LENGTH = String(Buffer.byteLength(BODY))

function guarded(opts?: RequestGuardOptions) {
  const app = new Hono()
  registerRequestGuard(app, opts)
  app.get('/', (c) => c.text('index'))
  app.get('/api/ping', (c) => c.json({ ok: true }))
  app.post('/api/echo', async (c) => c.json(await c.req.json()))
  app.post('/api/fetch', (c) => c.json({ started: true }))
  app.delete('/api/thing', (c) => c.json({ ok: true }))
  return app
}

const send = (app: Hono, method: string, path: string, headers: HeaderMap = {}, body?: string) =>
  app.request(path, { method, headers, body })

/** Headers of a JSON POST as a browser sends it from our own page. */
const browserJson = (extra: HeaderMap = {}): HeaderMap => ({
  host: HOST,
  origin: ORIGIN,
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
  'content-length': LENGTH,
  ...extra,
})

const expectRefused = async (res: Response, status: number, error: string) => {
  expect(res.status).toBe(status)
  expect((await res.json()) as ApiError).toEqual({ error })
}

describe('hostnameOf', () => {
  it.each([
    ['127.0.0.1:4321', '127.0.0.1'],
    ['127.0.0.1', '127.0.0.1'],
    ['localhost:4321', 'localhost'],
    ['LocalHost', 'localhost'],
    ['[::1]:4321', '::1'],
    ['[::1]', '::1'],
    ['evil.example:80', 'evil.example'],
    [' localhost ', 'localhost'],
  ])('parses %j as %j', (host, expected) => {
    expect(hostnameOf(host)).toBe(expected)
  })

  it.each(['', '   ', ':4321', 'localhost:', 'localhost:abc', 'a:b:c', '[::1', '[::1]x', '[]'])(
    'rejects %j',
    (host) => {
      expect(hostnameOf(host)).toBeNull()
    },
  )
})

describe('request guard: Host', () => {
  it('accepts loopback hosts with or without a port, case-insensitively', async () => {
    const app = guarded()
    for (const host of [
      '127.0.0.1:4321',
      'localhost:4321',
      '[::1]:4321',
      '127.0.0.1',
      'LOCALHOST',
      '[::1]',
    ]) {
      const res = await send(app, 'GET', '/api/ping', { host })
      expect(res.status, host).toBe(200)
    }
  })

  it('accepts a request without a Host header (the URL host stands in)', async () => {
    const res = await guarded().request('/api/ping')
    expect(res.status).toBe(200)
  })

  it('refuses every other host with a 403, on GET and for the UI shell too', async () => {
    const app = guarded()
    for (const host of [
      'evil.example',
      'evil.example:4321',
      '127.0.0.1.evil.example',
      'a:b:c',
      '',
      '[::1',
    ]) {
      await expectRefused(await send(app, 'GET', '/api/ping', { host }), 403, 'bad host')
      await expectRefused(await send(app, 'GET', '/', { host }), 403, 'bad host')
      await expectRefused(
        await send(app, 'POST', '/api/echo', browserJson({ host }), BODY),
        403,
        'bad host',
      )
    }
  })

  it('accepts the extra hosts from allowedHosts', async () => {
    const host = '192.168.1.5:4321'
    await expectRefused(await send(guarded(), 'GET', '/api/ping', { host }), 403, 'bad host')
    const app = guarded({ allowedHosts: ['192.168.1.5', 'Review-Box.local'] })
    expect((await send(app, 'GET', '/api/ping', { host })).status).toBe(200)
    expect((await send(app, 'GET', '/api/ping', { host: 'review-box.local:4321' })).status).toBe(
      200,
    )
    expect((await send(app, 'GET', '/api/ping', { host: 'localhost:4321' })).status).toBe(200)
    await expectRefused(
      await send(app, 'GET', '/api/ping', { host: 'evil.example' }),
      403,
      'bad host',
    )
  })
})

describe('request guard: mutations', () => {
  it('lets a same-origin JSON POST through', async () => {
    const res = await send(guarded(), 'POST', '/api/echo', browserJson(), BODY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ a: 1 })
  })

  it('lets a request without browser headers through (curl)', async () => {
    const headers = { host: HOST, 'content-type': 'application/json', 'content-length': LENGTH }
    const res = await send(guarded(), 'POST', '/api/echo', headers, BODY)
    expect(res.status).toBe(200)
  })

  it('lets bodiless POST and DELETE through without a content-type (the UI’s POST …/fetch)', async () => {
    const app = guarded()
    const base = { host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-origin' }
    expect((await send(app, 'POST', '/api/fetch', { ...base, 'content-length': '0' })).status).toBe(
      200,
    )
    expect((await send(app, 'POST', '/api/fetch', base)).status).toBe(200)
    expect((await send(app, 'DELETE', '/api/thing', base)).status).toBe(200)
  })

  it('refuses cross-site and same-site fetches, accepts user-initiated ones', async () => {
    const app = guarded()
    for (const site of ['cross-site', 'same-site', 'CROSS-SITE', 'bogus']) {
      const res = await send(
        app,
        'POST',
        '/api/echo',
        browserJson({ 'sec-fetch-site': site }),
        BODY,
      )
      await expectRefused(res, 403, 'cross-site request refused')
    }
    // `none`: the user typed or bookmarked it; a page had no hand in it.
    expect(
      (await send(app, 'POST', '/api/echo', browserJson({ 'sec-fetch-site': 'none' }), BODY))
        .status,
    ).toBe(200)
    // A text/plain "simple request" from a page is refused before its content-type even matters.
    const simple = browserJson({ 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' })
    await expectRefused(
      await send(app, 'POST', '/api/echo', simple, BODY),
      403,
      'cross-site request refused',
    )
  })

  it('falls back to Origin against Host when Sec-Fetch-Site is absent', async () => {
    const app = guarded()
    const noSite = (origin: string, host = HOST): HeaderMap => {
      const { 'sec-fetch-site': _dropped, ...rest } = browserJson({ origin, host })
      return rest
    }
    expect((await send(app, 'POST', '/api/echo', noSite(ORIGIN), BODY)).status).toBe(200)
    expect(
      (await send(app, 'POST', '/api/echo', noSite('http://[::1]:4321', '[::1]:4321'), BODY))
        .status,
    ).toBe(200)
    expect(
      (
        await send(
          app,
          'POST',
          '/api/echo',
          noSite('http://LOCALHOST:4321', 'localhost:4321'),
          BODY,
        )
      ).status,
    ).toBe(200)
    for (const origin of [
      'https://evil.example',
      'http://127.0.0.1:8000',
      'http://127.0.0.1',
      'null',
      'garbage',
    ]) {
      const res = await send(app, 'POST', '/api/echo', noSite(origin), BODY)
      await expectRefused(res, 403, 'cross-site request refused')
    }
  })

  it('requires application/json for any request that carries a body', async () => {
    const app = guarded()
    const refused = 'content-type must be application/json'
    await expectRefused(
      await send(app, 'POST', '/api/echo', browserJson({ 'content-type': 'text/plain' }), BODY),
      415,
      refused,
    )
    const { 'content-type': _none, ...withoutType } = browserJson()
    await expectRefused(await send(app, 'POST', '/api/echo', withoutType, BODY), 415, refused)
    const { 'content-length': _len, ...chunked } = browserJson({
      'transfer-encoding': 'chunked',
      'content-type': 'application/x-www-form-urlencoded',
    })
    await expectRefused(await send(app, 'POST', '/api/echo', chunked, BODY), 415, refused)

    const charset = browserJson({ 'content-type': 'Application/JSON; charset=utf-8' })
    expect((await send(app, 'POST', '/api/echo', charset, BODY)).status).toBe(200)
  })

  it('answers OPTIONS with 403 (no CORS is offered)', async () => {
    const headers = {
      host: HOST,
      origin: 'https://evil.example',
      'access-control-request-method': 'POST',
    }
    await expectRefused(
      await send(guarded(), 'OPTIONS', '/api/echo', headers),
      403,
      'cross-site request refused',
    )
    await expectRefused(
      await send(guarded(), 'OPTIONS', '/api/echo', { host: HOST }),
      403,
      'cross-site request refused',
    )
  })

  it('runs before routing', async () => {
    const res = await send(
      guarded(),
      'POST',
      '/api/nope',
      browserJson({ 'sec-fetch-site': 'cross-site' }),
      BODY,
    )
    await expectRefused(res, 403, 'cross-site request refused')
  })
})
