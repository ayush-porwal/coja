import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ForgeError } from '../forge/forge.js'
import { GitError } from '../git/run.js'
import type { ApiError } from '../shared/api.js'
import { HttpError, onApiError } from './http.js'

/** An app whose only route throws `err`, so every response comes from `onApiError`. */
async function responseFor(err: unknown): Promise<{ status: number; body: ApiError }> {
  const app = new Hono()
  app.onError(onApiError)
  app.get('/', () => {
    throw err
  })
  const res = await app.request('/')
  return { status: res.status, body: (await res.json()) as ApiError }
}

describe('onApiError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the message (and code) of the error kinds routes raise on purpose', async () => {
    expect(await responseFor(new HttpError(404, 'project not found', 'not_found'))).toEqual({
      status: 404,
      body: { error: 'project not found', code: 'not_found' },
    })
    expect(await responseFor(new HttpError(409, 'not fetched yet'))).toEqual({
      status: 409,
      body: { error: 'not fetched yet' },
    })
    expect(await responseFor(new ForgeError('Can not approve your own pull request', 422))).toEqual(
      { status: 422, body: { error: 'Can not approve your own pull request', code: 'github' } },
    )
    // A ForgeError with a non-HTTP status is the host's fault: 502.
    expect((await responseFor(new ForgeError('odd', 999))).status).toBe(502)
    expect(
      await responseFor(new GitError(['-C', 'x', 'fetch'], 128, 'fatal: nope', 'git fetch failed')),
    ).toEqual({ status: 500, body: { error: 'git fetch failed', code: 'git' } })

    const zod = await responseFor(z.object({ path: z.string() }).safeParse({}).error)
    expect(zod.status).toBe(400)
    expect(zod.body.code).toBe('bad_request')
    expect(zod.body.error).toContain('invalid request')
  })

  it('answers unknown errors with a generic message and logs the real one server-side', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('ENOENT: /Users/someone/.local/share/coja/secret.db')
    expect(await responseFor(err)).toEqual({ status: 500, body: { error: 'internal error' } })
    expect(log).toHaveBeenCalledWith(err)
    // Hono only hands Error instances to onError; called directly, anything else is generic too.
    const app = new Hono()
    app.get('/', (c) => onApiError('a string, not even an Error', c))
    const res = await app.request('/')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal error' })
    expect(log).toHaveBeenLastCalledWith('a string, not even an Error')
  })
})
