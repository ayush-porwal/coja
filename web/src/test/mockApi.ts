import { vi } from 'vitest'

export interface RecordedCall {
  method: string
  /** Pathname plus query string, e.g. `/api/setup/key?provider=openai`. */
  url: string
  body: unknown
}

export interface RouteContext {
  body: unknown
  /** How many times this route was hit before this call (0 on the first hit). */
  count: number
  url: URL
}

/**
 * A JSON body (sent as 200) or a ready `Response`. Deliberately narrower than
 * `unknown`, which would swallow the function member of `RouteHandler` and
 * leave handler parameters untyped.
 */
export type RouteResult = object | string | number | boolean | null
export type RouteFn = (ctx: RouteContext) => RouteResult | Promise<RouteResult>
/**
 * A static result or a function producing one. Use a function for a non-2xx
 * response that may be hit more than once: a `Response` body reads only once.
 */
export type RouteHandler = RouteResult | RouteFn

/** Keys are `"METHOD /path"`; a key may include a query string for an exact match. */
export type MockRoutes = Record<string, RouteHandler>

export interface MockApi {
  calls: RecordedCall[]
  fetch: ReturnType<typeof vi.fn>
  /** Calls to one route, e.g. `mock.callsTo('POST', '/api/projects')`. */
  callsTo: (method: string, url: string) => RecordedCall[]
}

/** Builds an ApiError response like the server's. */
export function jsonError(status: number, error: string, code?: string): Response {
  return Response.json({ error, ...(code ? { code } : {}) }, { status })
}

/**
 * Stubs global `fetch` with a tiny router. Unmatched requests get a 404 with a
 * descriptive error so a wrong URL fails loudly in the assertion output.
 */
export function installMockApi(routes: MockRoutes): MockApi {
  const calls: RecordedCall[] = []
  const hits = new Map<string, number>()

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(raw, 'http://localhost')
      const method = (
        init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
      ).toUpperCase()
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      const withQuery = `${url.pathname}${url.search}`
      calls.push({ method, url: withQuery, body })

      const key = `${method} ${withQuery}`
      const fallbackKey = `${method} ${url.pathname}`
      const matchedKey = key in routes ? key : fallbackKey in routes ? fallbackKey : undefined
      if (matchedKey === undefined) {
        return Response.json({ error: `no mock route for ${key}` }, { status: 404 })
      }

      const count = hits.get(matchedKey) ?? 0
      hits.set(matchedKey, count + 1)
      const handler = routes[matchedKey]
      const result =
        typeof handler === 'function' ? await (handler as RouteFn)({ body, count, url }) : handler
      return result instanceof Response ? result : Response.json(result)
    },
  )

  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    fetch: fetchMock,
    callsTo: (method, url) =>
      calls.filter((c) => c.method === method.toUpperCase() && c.url === url),
  }
}

/** A promise you resolve by hand, to hold a request in flight while asserting on pending UI. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
