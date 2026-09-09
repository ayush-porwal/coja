import { describe, expect, it, vi } from 'vitest'
import { createContributorLookup } from './contributors.js'

describe('contributor lookup', () => {
  it('ranks authenticated contributors and reuses concurrent and cached requests', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { login: 'newcomer', contributions: 2 },
            { login: 'julius', contributions: 900 },
            { name: 'anonymous', contributions: 1 },
            null,
            42,
            true,
            'invalid',
            [],
            { login: 'invalid-count', contributions: '10' },
          ]),
        ),
      )
    const lookup = createContributorLookup({ getToken: async () => 'token', fetchImpl })
    const repo = { owner: 'org', repo: 'repo' }
    const [result, concurrent] = await Promise.all([lookup(repo), lookup(repo)])
    expect(result).toEqual([
      { login: 'julius', contributions: 900 },
      { login: 'newcomer', contributions: 2 },
    ])
    expect(concurrent).toEqual(result)
    await lookup(repo)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo/contributors?per_page=100',
      expect.objectContaining({ redirect: 'error' }),
    )
  })
  it('does not cache failures and handles empty repositories', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const lookup = createContributorLookup({ getToken: async () => 'token', fetchImpl })
    await expect(lookup({ owner: 'org', repo: 'repo' })).rejects.toThrow('Could not load')
    await expect(lookup({ owner: 'org', repo: 'repo' })).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
