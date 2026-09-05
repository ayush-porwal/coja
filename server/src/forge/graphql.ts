import { ForgeError } from './forge.js'
import { invalidateTokenCache } from './gh-cli.js'

/**
 * Minimal GitHub GraphQL client: one POST per operation, the token fetched
 * lazily from `getToken` on every call (so a refreshed gh login is picked up
 * without a restart). Failures become ForgeErrors with an HTTP status the API
 * layer can forward; the token itself never appears in any message.
 */

export type GqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>

export interface GraphqlClientOptions {
  getToken: () => Promise<string>
  fetchImpl?: typeof fetch
  endpoint?: string
  /** Runs when GitHub answers 401, before the error is thrown. Default: drop gh's cached token. */
  onUnauthorized?: () => void
  timeoutMs?: number
}

export const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'

export interface GraphqlErrorItem {
  type?: string
  message: string
  path?: (string | number)[]
}

interface GraphqlResponse<T> {
  data?: T | null
  errors?: GraphqlErrorItem[]
}

export const TOKEN_REJECTED =
  'GitHub rejected the token from gh. Run `gh auth login` (or `gh auth refresh`) in your terminal and try again.'

export function createGraphqlClient(opts: GraphqlClientOptions): GqlFn {
  const {
    getToken,
    fetchImpl = fetch,
    endpoint = GITHUB_GRAPHQL_ENDPOINT,
    onUnauthorized = invalidateTokenCache,
    timeoutMs = 30_000,
  } = opts

  return async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const token = await getToken()
    let res: Response
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'coja',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new ForgeError(`Could not reach GitHub: ${errorMessage(err)}`, 502)
    }

    if (res.status === 401) {
      onUnauthorized()
      throw new ForgeError(TOKEN_REJECTED, 401)
    }
    if (!res.ok) {
      throw new ForgeError(describeHttpFailure(res, await safeText(res)), res.status)
    }

    let body: GraphqlResponse<T>
    try {
      body = (await res.json()) as GraphqlResponse<T>
    } catch {
      throw new ForgeError('GitHub returned an unreadable response.', 502)
    }
    if (body.errors && body.errors.length > 0) {
      throw new ForgeError(
        body.errors.map((e) => e.message).join('; '),
        statusForGraphqlErrors(body.errors),
        body.errors,
      )
    }
    if (body.data == null) throw new ForgeError('GitHub returned no data.', 502)
    return body.data
  }
}

/**
 * GitHub tags GraphQL errors with a `type`. Validation failures the user can
 * act on (e.g. "Can not approve your own pull request") are UNPROCESSABLE →
 * 422; missing objects → 404; permission problems → 403; the rest is the
 * host's (or our query's) fault → 502.
 */
export function statusForGraphqlErrors(errors: readonly GraphqlErrorItem[]): number {
  const types = new Set(errors.map((e) => e.type))
  if (types.has('UNPROCESSABLE')) return 422
  if (types.has('NOT_FOUND')) return 404
  if (types.has('FORBIDDEN') || types.has('INSUFFICIENT_SCOPES')) return 403
  if (types.has('RATE_LIMITED')) return 429
  return 502
}

function describeHttpFailure(res: Response, text: string): string {
  const retryAfter = res.headers.get('retry-after')
  const remaining = res.headers.get('x-ratelimit-remaining')
  if ((res.status === 403 || res.status === 429) && (retryAfter || remaining === '0')) {
    const reset = res.headers.get('x-ratelimit-reset')
    const when = retryAfter
      ? `in ${retryAfter}s`
      : reset
        ? `at ${new Date(Number(reset) * 1000).toISOString()}`
        : 'later'
    return `GitHub rate limit exceeded; try again ${when}.`
  }
  const detail = messageFromBody(text)
  return `GitHub API request failed with HTTP ${res.status}${detail ? `: ${detail}` : ''}`
}

function messageFromBody(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { message?: unknown }
    return typeof parsed?.message === 'string' ? parsed.message : undefined
  } catch {
    return undefined
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: { message?: string } }).cause
    return cause?.message ? `${err.message} (${cause.message})` : err.message
  }
  return String(err)
}
