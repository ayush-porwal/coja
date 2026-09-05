import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { ServerContext } from '../context.js'
import { settings } from '../db.js'
import { listModels, validateApiKey } from '../secrets/providers.js'
import { providerKeyName, type SecretStore } from '../secrets/store.js'
import {
  API_ROUTES,
  type GhAuthStatus,
  type ModelInfo,
  PROVIDERS,
  type ProviderId,
  type SaveKeyResponse,
  type SetupStatus,
} from '../shared/api.js'
import { badRequest, HttpError } from './http.js'

/**
 * Setup screen and AI-model routes (design.md, "Setup"). The GitHub step is
 * read-only (`gh auth status`); the AI step stores provider keys in the
 * SecretStore after validating them with the provider. Keys never leave the
 * server: every response carries `configured: boolean` at most.
 */

/** Settings key: '1' once the user saved a key or explicitly skipped the AI step. */
export const SETUP_COMPLETE_KEY = 'setup_complete'
export const MODEL_CACHE_TTL_MS = 10 * 60 * 1000

export interface SetupRouteDeps {
  secrets: SecretStore
  /** `ghAuthStatus` from server/src/forge/gh-cli.ts, injected so this module does not depend on it. */
  ghAuthStatus: () => Promise<GhAuthStatus>
  /** Defaults to the global fetch; tests pass a fake. */
  fetchImpl?: typeof fetch
  /** Defaults to a fresh 10-minute cache; pass one to share or control it. */
  modelCache?: ModelCache
}

/** Per-provider cache of `listModels` results, so the picker does not hit the provider on every render. */
export class ModelCache {
  private readonly entries = new Map<
    ProviderId,
    { models: Promise<ModelInfo[]>; expiresAt: number }
  >()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(ttlMs: number = MODEL_CACHE_TTL_MS, now: () => number = Date.now) {
    this.ttlMs = ttlMs
    this.now = now
  }

  /** The cached list for `provider`, or the result of `load()` cached for the TTL. In-flight loads are shared. */
  getOrLoad(provider: ProviderId, load: () => Promise<ModelInfo[]>): Promise<ModelInfo[]> {
    const hit = this.entries.get(provider)
    if (hit && hit.expiresAt > this.now()) return hit.models
    const models = load()
    this.entries.set(provider, { models, expiresAt: this.now() + this.ttlMs })
    models.catch(() => {
      if (this.entries.get(provider)?.models === models) this.entries.delete(provider)
    })
    return models
  }

  /** Forget one provider's list, or all of them. Call whenever a key is saved or deleted. */
  clear(provider?: ProviderId): void {
    if (provider) this.entries.delete(provider)
    else this.entries.clear()
  }
}

const providerSchema = z.enum(PROVIDERS)
const saveKeySchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(1, 'apiKey must not be empty'),
})
const deleteKeyQuerySchema = z.object({ provider: providerSchema })

export function registerSetupRoutes(
  app: Hono,
  ctx: ServerContext,
  deps: SetupRouteDeps,
): { modelCache: ModelCache } {
  const { secrets } = deps
  const fetchImpl = deps.fetchImpl ?? fetch
  const modelCache = deps.modelCache ?? new ModelCache()

  const ghStatus = async (): Promise<GhAuthStatus> => {
    try {
      return await deps.ghAuthStatus()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not check the GitHub CLI: ${message}` }
    }
  }

  const hasKey = async (provider: ProviderId): Promise<boolean> =>
    Boolean(await secrets.get(providerKeyName(provider)))

  const status = async (): Promise<SetupStatus> => {
    const [gh, openai, anthropic] = await Promise.all([
      ghStatus(),
      hasKey('openai'),
      hasKey('anthropic'),
    ])
    return {
      gh,
      providers: { openai: { configured: openai }, anthropic: { configured: anthropic } },
      secrets: { backend: secrets.backend },
      setupComplete: settings.get(ctx.db, SETUP_COMPLETE_KEY) === '1',
    }
  }

  const modelsFor = async (provider: ProviderId): Promise<ModelInfo[]> => {
    const apiKey = await secrets.get(providerKeyName(provider))
    if (!apiKey) return []
    return modelCache.getOrLoad(provider, () => listModels(provider, apiKey, fetchImpl))
  }

  app.get(API_ROUTES.setupStatus, async (c) => c.json<SetupStatus>(await status()))

  app.post(API_ROUTES.setupKey, async (c) => {
    const { provider, apiKey } = parseOr400(saveKeySchema, await readJson(c))
    const verdict = await validateApiKey(provider, apiKey, fetchImpl)
    if (!verdict.ok) throw new HttpError(400, verdict.error, 'provider')
    await secrets.set(providerKeyName(provider), apiKey)
    settings.set(ctx.db, SETUP_COMPLETE_KEY, '1')
    modelCache.clear(provider)
    return c.json<SaveKeyResponse>({ ok: true, provider })
  })

  app.delete(API_ROUTES.setupKey, async (c) => {
    const { provider } = parseOr400(deleteKeyQuerySchema, { provider: c.req.query('provider') })
    await secrets.delete(providerKeyName(provider))
    modelCache.clear(provider)
    return c.json({ ok: true as const })
  })

  app.post(API_ROUTES.setupComplete, async (c) => {
    settings.set(ctx.db, SETUP_COMPLETE_KEY, '1')
    return c.json<SetupStatus>(await status())
  })

  app.get(API_ROUTES.aiModels, async (c) => {
    const lists = await Promise.all(PROVIDERS.map(modelsFor))
    return c.json<ModelInfo[]>(lists.flat())
  })

  return { modelCache }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw badRequest('expected a JSON body')
  }
}

/** Validate with zod; a failure becomes a 400 whose message names the offending fields. */
function parseOr400<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const details = result.error.issues
    .map((issue) => `${issue.path.map(String).join('.') || 'body'}: ${issue.message}`)
    .join('; ')
  throw badRequest(`invalid request: ${details}`)
}
