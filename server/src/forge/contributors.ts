import type { RepositoryContributor } from '../shared/api.js'
import { ForgeError, type RepoRef } from './forge.js'
import { invalidateTokenCache } from './gh-cli.js'
import { TOKEN_REJECTED } from './graphql.js'

/** GitHub's top 100 contributors, cached separately from PR browsing. */
export function createContributorLookup({
  getToken,
  fetchImpl = fetch,
}: {
  getToken: () => Promise<string>
  fetchImpl?: typeof fetch
}) {
  const cache = new Map<string, { until: number; result: Promise<RepositoryContributor[]> }>()
  return (repo: RepoRef): Promise<RepositoryContributor[]> => {
    const key = `${repo.owner}/${repo.repo}`.toLowerCase()
    const cached = cache.get(key)
    if (cached && cached.until > Date.now()) return cached.result
    const result = (async () => {
      const token = await getToken()
      let response: Response
      try {
        response = await fetchImpl(
          `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contributors?per_page=100`,
          {
            redirect: 'error',
            headers: {
              authorization: `Bearer ${token}`,
              accept: 'application/vnd.github+json',
              'user-agent': 'coja',
            },
            signal: AbortSignal.timeout(15_000),
          },
        )
      } catch {
        throw new ForgeError('Could not load GitHub contributors.', 502)
      }
      if (response.status === 401) {
        invalidateTokenCache()
        throw new ForgeError(TOKEN_REJECTED, 401)
      }
      if (!response.ok) throw new ForgeError('Could not load GitHub contributors.', response.status)
      if (response.status === 204) return []
      const rows: unknown = await response.json()
      if (!Array.isArray(rows))
        throw new ForgeError('GitHub returned unreadable contributors.', 502)
      return rows
        .filter(
          (row: unknown): row is RepositoryContributor =>
            typeof row === 'object' &&
            row !== null &&
            !Array.isArray(row) &&
            'login' in row &&
            typeof row.login === 'string' &&
            'contributions' in row &&
            typeof row.contributions === 'number',
        )
        .map((row) => ({ login: row.login, contributions: row.contributions }))
        .sort((a, b) => b.contributions - a.contributions)
    })()
    cache.set(key, { until: Date.now() + 30 * 60_000, result })
    result.catch(() => {
      if (cache.get(key)?.result === result) cache.delete(key)
    })
    return result
  }
}
