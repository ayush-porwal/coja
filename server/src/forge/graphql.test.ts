import { describe, expect, it, vi } from 'vitest'
import { ForgeError } from './forge.js'
import { createGraphqlClient, statusForGraphqlErrors, TOKEN_REJECTED } from './graphql.js'

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

function client(fetchImpl: typeof fetch, onUnauthorized = vi.fn()) {
  const gql = createGraphqlClient({
    getToken: async () => 'gho_test',
    fetchImpl,
    onUnauthorized,
    endpoint: 'https://example.test/graphql',
  })
  return { gql, onUnauthorized }
}

describe('createGraphqlClient', () => {
  it('POSTs the operation with the bearer token and returns data', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { viewer: { login: 'me' } } }))
    const { gql } = client(fetchImpl)
    await expect(gql('query { viewer { login } }', { a: 1 })).resolves.toEqual({
      viewer: { login: 'me' },
    })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.test/graphql')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('bearer gho_test')
    expect(headers['content-type']).toBe('application/json')
    expect(headers['user-agent']).toBe('coja')
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'query { viewer { login } }',
      variables: { a: 1 },
    })
  })

  it('maps HTTP 401 to a 401 ForgeError and invalidates the token', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }))
    const { gql, onUnauthorized } = client(fetchImpl)
    const err = await gql('query { x }').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ForgeError)
    expect(err).toMatchObject({ status: 401, message: TOKEN_REJECTED })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect((err as Error).message).not.toContain('gho_test')
  })

  it('maps other non-2xx responses to their status', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'Server Error' }, { status: 502 }))
    const { gql, onUnauthorized } = client(fetchImpl)
    await expect(gql('query { x }')).rejects.toMatchObject({
      status: 502,
      message: 'GitHub API request failed with HTTP 502: Server Error',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('explains rate limiting', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { message: 'API rate limit exceeded' },
          { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '30' } },
        ),
      )
    const { gql } = client(fetchImpl)
    await expect(gql('query { x }')).rejects.toMatchObject({
      status: 403,
      message: 'GitHub rate limit exceeded; try again in 30s.',
    })
  })

  it('turns GraphQL errors into a ForgeError with the joined messages', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: null,
        errors: [
          { type: 'UNPROCESSABLE', message: 'Can not approve your own pull request' },
          { type: 'UNPROCESSABLE', message: 'Body can not be blank' },
        ],
      }),
    )
    const { gql } = client(fetchImpl)
    const err = await gql('mutation { x }').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ForgeError)
    expect(err).toMatchObject({
      status: 422,
      message: 'Can not approve your own pull request; Body can not be blank',
    })
  })

  it('maps NOT_FOUND errors to 404 and untyped errors to 502', async () => {
    const notFound = client(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: { repository: null },
          errors: [
            {
              type: 'NOT_FOUND',
              message: "Could not resolve to a Repository with the name 'a/b'.",
            },
          ],
        }),
      ),
    )
    await expect(notFound.gql('query { x }')).rejects.toMatchObject({ status: 404 })

    const untyped = client(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse({ errors: [{ message: "Field 'nope' doesn't exist on type 'Query'" }] }),
        ),
    )
    await expect(untyped.gql('query { nope }')).rejects.toMatchObject({ status: 502 })
  })

  it('fails with 502 when GitHub is unreachable or answers garbage', async () => {
    const down = client(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')))
    await expect(down.gql('query { x }')).rejects.toMatchObject({
      status: 502,
      message: 'Could not reach GitHub: fetch failed',
    })

    const garbage = client(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 })),
    )
    await expect(garbage.gql('query { x }')).rejects.toMatchObject({ status: 502 })

    const noData = client(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: null })))
    await expect(noData.gql('query { x }')).rejects.toMatchObject({ status: 502 })
  })
})

describe('statusForGraphqlErrors', () => {
  it('classifies by GitHub error type', () => {
    expect(statusForGraphqlErrors([{ type: 'UNPROCESSABLE', message: '' }])).toBe(422)
    expect(statusForGraphqlErrors([{ type: 'NOT_FOUND', message: '' }])).toBe(404)
    expect(statusForGraphqlErrors([{ type: 'FORBIDDEN', message: '' }])).toBe(403)
    expect(statusForGraphqlErrors([{ type: 'INSUFFICIENT_SCOPES', message: '' }])).toBe(403)
    expect(statusForGraphqlErrors([{ type: 'RATE_LIMITED', message: '' }])).toBe(429)
    expect(statusForGraphqlErrors([{ type: 'SERVICE_UNAVAILABLE', message: '' }])).toBe(502)
    expect(statusForGraphqlErrors([{ message: '' }])).toBe(502)
    // A user-fixable error anywhere in the list wins over host-side noise.
    expect(
      statusForGraphqlErrors([
        { type: 'INTERNAL', message: '' },
        { type: 'UNPROCESSABLE', message: '' },
      ]),
    ).toBe(422)
  })
})
