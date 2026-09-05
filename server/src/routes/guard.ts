import type { Context, Hono, MiddlewareHandler } from 'hono'
import type { ApiError } from '../shared/api.js'

/**
 * Request guard against the two ways a web page can reach a local server:
 *
 * - **DNS rebinding**: a page on `evil.example` whose DNS answer flips to
 *   127.0.0.1 talks to us with `Host: evil.example`. Every request must name
 *   a hostname we actually serve under (loopback, plus `allowedHosts`).
 * - **Cross-site requests**: a page on any origin can POST a "simple" request
 *   (`text/plain` body, no preflight) to `http://127.0.0.1:4321/api/…`. There
 *   is no CORS here, so the page never reads the answer — but the mutation
 *   would still happen. Mutating requests must therefore come from our own
 *   origin: `Sec-Fetch-Site` when the browser sends it, else `Origin` must
 *   match `Host`. Requests with neither (curl, scripts on this machine) are
 *   allowed: a local process is not the threat this guards against. Bodies must
 *   be `application/json`, which a page cannot send without a preflight, and
 *   preflights (OPTIONS) are refused outright.
 */

export interface RequestGuardOptions {
  /**
   * Hostnames (without port or IPv6 brackets) the UI may be reached under
   * besides loopback — pass the `--host` value when it is not a loopback
   * address. Matched case-insensitively.
   */
  allowedHosts?: readonly string[]
}

const LOOPBACK_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '::1']

/** Methods that never mutate here; the UI only ever reads through them. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD'])

/** `app.use(requestGuard())` — see {@link registerRequestGuard}. */
export function requestGuard(opts: RequestGuardOptions = {}): MiddlewareHandler {
  const allowed = new Set([
    ...LOOPBACK_HOSTNAMES,
    ...(opts.allowedHosts ?? []).map((h) => h.trim().toLowerCase()),
  ])

  return async (c, next) => {
    // The Node adapter builds the request URL from the Host header, so the URL's host is the
    // same thing; it is the fallback when a request has no Host header (tests, HTTP/1.0).
    const host = c.req.header('host') ?? new URL(c.req.url).host
    const hostname = hostnameOf(host)
    if (hostname === null || !allowed.has(hostname)) {
      // Name the offender: someone who reached this over `--host` sees at once which Host was refused.
      return forbidden(
        c,
        `bad host "${host.slice(0, 200)}": only loopback or the --host address is served`,
      )
    }

    const method = c.req.method.toUpperCase()
    // No CORS is offered, so a preflight can only be a cross-origin page probing us.
    if (method === 'OPTIONS') return forbidden(c, 'cross-site request refused')
    if (SAFE_METHODS.has(method)) return next()

    const site = c.req.header('sec-fetch-site')?.trim().toLowerCase()
    if (site !== undefined) {
      // `same-site` is not enough: another local server on a different port is same-site.
      if (site !== 'same-origin' && site !== 'none') {
        return forbidden(c, 'cross-site request refused')
      }
    } else {
      const origin = c.req.header('origin')
      if (origin !== undefined && !originMatchesHost(origin, host)) {
        return forbidden(c, 'cross-site request refused')
      }
    }

    if (hasBody(c) && !isJson(c.req.header('content-type'))) {
      return c.json<ApiError>({ error: 'content-type must be application/json' }, 415)
    }
    return next()
  }
}

/** Install the guard on `app` before any route, so it runs for every request. */
export function registerRequestGuard(app: Hono, opts: RequestGuardOptions = {}): void {
  app.use('*', requestGuard(opts))
}

/**
 * Hostname of a `Host` header value, lower-cased and without port or IPv6
 * brackets: `127.0.0.1:4321` → `127.0.0.1`, `[::1]:4321` → `::1`,
 * `LocalHost` → `localhost`. Null when the value is not a valid host.
 */
export function hostnameOf(host: string): string | null {
  const value = host.trim().toLowerCase()
  if (value === '') return null
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end === -1) return null
    const port = value.slice(end + 1)
    if (port !== '' && !/^:\d{1,5}$/.test(port)) return null
    return value.slice(1, end) || null
  }
  const parts = value.split(':')
  if (parts.length > 2) return null // an IPv6 literal must be bracketed
  const [name, port] = parts
  if (!name || (port !== undefined && !/^\d{1,5}$/.test(port))) return null
  return name
}

/** True when `origin` (an `Origin` header) names the same host and port as `host` (a `Host` header). */
function originMatchesHost(origin: string, host: string): boolean {
  try {
    // Parsing both normalises case and default ports (`localhost:80` ≡ `localhost` over http).
    return new URL(origin).host === new URL(`http://${host}`).host
  } catch {
    return false // `Origin: null`, or malformed
  }
}

/** A request carries a body iff it declares one (RFC 9112 §6): Content-Length or Transfer-Encoding. */
function hasBody(c: Context): boolean {
  const length = c.req.header('content-length')
  if (length !== undefined) return length.trim() !== '0'
  return c.req.header('transfer-encoding') !== undefined
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

function forbidden(c: Context, error: string): Response {
  return c.json<ApiError>({ error }, 403)
}
