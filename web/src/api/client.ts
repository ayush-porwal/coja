import type { ApiError } from '@coja/shared/api'

/** Thrown for every non-2xx API response; `code` mirrors the server's ApiError. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: ApiError['code'],
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

/**
 * Hard cap per API call. The chat stream's POST does not go through here (the
 * AI transport owns its own fetch and legitimately runs for minutes), so every
 * request here is a short JSON call that should answer within seconds. Without
 * this, a server that is mid-restart leaves queries pending forever and the
 * UI stuck on a loader with no way to retry.
 */
const REQUEST_TIMEOUT_MS = 15_000

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    // Map the two silent-to-the-user failure modes onto actionable messages.
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new ApiRequestError(
        `${method} ${url} timed out — the coja server may be restarting; try again`,
        0,
      )
    }
    if (e instanceof TypeError) {
      throw new ApiRequestError('Cannot reach the coja server — is it still running?', 0)
    }
    throw e
  }
  if (!res.ok) {
    let message = `${method} ${url} failed with ${res.status}`
    let code: ApiError['code']
    try {
      const err = (await res.json()) as Partial<ApiError>
      if (err.error) message = err.error
      code = err.code
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new ApiRequestError(message, res.status, code)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
}
