import { ChatGptConnection } from './codex/connection.js'
import { createContext, type ServerContext } from './context.js'
import { createContributorLookup } from './forge/contributors.js'
import type { Forge } from './forge/forge.js'
import { ghAuthStatus, ghToken } from './forge/gh-cli.js'
import { GitHubForge } from './forge/github.js'
import { createGraphqlClient } from './forge/graphql.js'
import { PrFetcher } from './pr/fetcher.js'
import { openSecretStore, type SecretStore } from './secrets/store.js'
import type { GhAuthStatus } from './shared/api.js'

/**
 * Process-wide services behind the API. Built once in the CLI and handed to
 * `createApp`; tests build their own with fakes.
 *
 * Note the deliberate shape: the `Forge` (the only thing that can mutate
 * review state on GitHub) is passed to the review/pull/git route modules
 * only. The AI layer never receives it.
 */
export interface AppServices {
  ctx: ServerContext
  forge: Forge
  fetcher: PrFetcher
  secrets: SecretStore
  ghAuthStatus: () => Promise<GhAuthStatus>
  /** ChatGPT-subscription connection (tokens live in the keychain). */
  chatgpt: ChatGptConnection
}

export async function createServices(opts: { dataDir?: string } = {}): Promise<AppServices> {
  const ctx = createContext(opts)
  const secrets = await openSecretStore({ dataDir: ctx.dataDir })
  const forge = new GitHubForge({
    gql: createGraphqlClient({ getToken: ghToken }),
    contributors: createContributorLookup({ getToken: ghToken }),
  })
  const fetcher = new PrFetcher()
  const chatgpt = new ChatGptConnection({ secrets, db: ctx.db })
  return { ctx, forge, fetcher, secrets, ghAuthStatus, chatgpt }
}
