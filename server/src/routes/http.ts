import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ForgeError } from '../forge/forge.js'
import type { ApiError } from '../shared/api.js'

/** Error with an HTTP status, raised by route handlers and domain code. */
export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly code?: ApiError['code'],
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`, 'not_found')
export const badRequest = (message: string) => new HttpError(400, message, 'bad_request')

/** Serialize any thrown value as an ApiError response. Register with `app.onError(onApiError)`. */
export function onApiError(err: unknown, c: Context): Response {
  if (err instanceof HttpError) {
    return c.json<ApiError>(
      { error: err.message, ...(err.code ? { code: err.code } : {}) },
      err.status,
    )
  }
  if (err instanceof ForgeError) {
    const status = (
      err.status >= 400 && err.status <= 599 ? err.status : 502
    ) as ContentfulStatusCode
    return c.json<ApiError>({ error: err.message, code: 'github' }, status)
  }
  const anyErr = err as { name?: string; message?: string; issues?: unknown }
  if (anyErr?.name === 'ZodError') {
    return c.json<ApiError>(
      { error: `invalid request: ${anyErr.message}`, code: 'bad_request' },
      400,
    )
  }
  if (anyErr?.name === 'GitError') {
    return c.json<ApiError>({ error: anyErr.message ?? 'git failed', code: 'git' }, 500)
  }
  console.error(err)
  return c.json<ApiError>({ error: anyErr?.message ?? 'internal error' }, 500)
}
