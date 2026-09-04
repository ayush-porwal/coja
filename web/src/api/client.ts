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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
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
