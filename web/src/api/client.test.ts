import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, api } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('returns parsed JSON on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })),
    )
    await expect(api.get('/api/x')).resolves.toEqual({ ok: 1 })
  })

  it('throws ApiRequestError with the server message on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'not found', code: 'not_found' }), { status: 404 }),
      ),
    )
    const err = await api.get('/api/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiRequestError)
    expect((err as ApiRequestError).message).toBe('not found')
    expect((err as ApiRequestError).status).toBe(404)
    expect((err as ApiRequestError).code).toBe('not_found')
  })

  it('maps a dead server (fetch TypeError) onto an actionable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const err = await api.get('/api/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiRequestError)
    expect((err as ApiRequestError).message).toContain('Cannot reach the coja server')
    expect((err as ApiRequestError).status).toBe(0)
  })

  it('maps a hung server (abort timeout) onto an actionable message', async () => {
    // What AbortSignal.timeout produces when the request never answers.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
      ),
    )
    const err = await api.get('/api/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiRequestError)
    expect((err as ApiRequestError).message).toContain('timed out')
    expect((err as ApiRequestError).status).toBe(0)
  })
})
