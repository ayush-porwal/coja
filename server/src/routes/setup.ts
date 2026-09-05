import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { ChatGptConnection } from '../codex/connection.js'
import type { ServerContext } from '../context.js'
import {
  addCustomProviderSchema,
  deleteCustomProvider,
  getCustomProvider,
  listCustomProviders,
  saveCustomProvider,
} from '../custom-providers.js'
import { settings } from '../db.js'
import { curatedModels } from '../secrets/providers.js'
import { providerKeyName, type SecretStore } from '../secrets/store.js'
import type { CustomProviderConfig, CustomProviderSummary } from '../shared/api.js'
import {
  API_ROUTES,
  type ChatGptConnectStatus,
  type CustomProvidersResponse,
  type GhAuthStatus,
  type ModelInfo,
  parseChatGptMarker,
  type SetupStatus,
} from '../shared/api.js'
import { badRequest, HttpError } from './http.js'

/**
 * Setup screen and AI-model routes (design.md, "Setup"). The GitHub step is
 * read-only (`gh auth status`); the AI step stores provider keys in the
 * SecretStore after validating them with the provider. Keys never leave the
 * server: every response carries `configured: boolean` at most. The
 * ChatGPT route is the one non-key path: the server runs the
 * browser OAuth flow, tokens land in the SecretStore, and the browser sees
 * connection facts only.
 */

/** Settings key: '1' once the user saved a key or explicitly skipped the AI step. */
export const SETUP_COMPLETE_KEY = 'setup_complete'
export const MODEL_CACHE_TTL_MS = 10 * 60 * 1000

export interface SetupRouteDeps {
  secrets: SecretStore
  /** `ghAuthStatus` from server/src/forge/gh-cli.ts, injected so this module does not depend on it. */
  ghAuthStatus: () => Promise<GhAuthStatus>
  /** The ChatGPT-subscription connection, when wired. */
  chatgpt?: ChatGptConnection
  /** Defaults to the global fetch; tests pass a fake (model-list probe). */
  fetchImpl?: typeof fetch
}

export function registerSetupRoutes(app: Hono, ctx: ServerContext, deps: SetupRouteDeps): void {
  const { secrets } = deps
  const fetchImpl = deps.fetchImpl ?? fetch

  const ghStatus = async (): Promise<GhAuthStatus> => {
    try {
      return await deps.ghAuthStatus()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Could not check the GitHub CLI: ${message}` }
    }
  }

  const chatgptStatus = async (): Promise<SetupStatus['chatgpt']> => {
    if (!deps.chatgpt) return { connected: false }
    const { signingIn: _signingIn, ...rest } = await deps.chatgpt.status()
    return rest
  }

  const status = async (): Promise<SetupStatus> => {
    const [gh, chatgpt] = await Promise.all([ghStatus(), chatgptStatus()])
    return {
      gh,
      customProviders: await Promise.all(listCustomProviders(ctx.db).map(decorate)),
      secrets: { backend: secrets.backend },
      setupComplete: settings.get(ctx.db, SETUP_COMPLETE_KEY) === '1',
      chatgpt,
    }
  }

  /** Config + whether a key is stored — the API never returns key material. */
  const decorate = async (p: CustomProviderConfig): Promise<CustomProviderSummary> => ({
    ...p,
    hasKey: Boolean(await secrets.get(providerKeyName(p.id))),
  })

  /**
   * The subscription picker comes from the backend's model catalog (per-plan
   * ground truth, incl. per-model reasoning efforts), gated on the connection.
   * A catalog failure falls back to the short curated bootstrap list so the
   * picker never empties.
   */
  const subscriptionModels = async (): Promise<ModelInfo[]> => {
    if (!deps.chatgpt) return []
    const state = await deps.chatgpt.status()
    if (!state.connected) return []
    try {
      const models = await deps.chatgpt.listModels()
      return models.map((m) => ({
        id: `chatgpt:${m.slug}`,
        provider: 'chatgpt' as const,
        modelId: m.slug,
        label: m.displayName,
        reasoningEfforts: m.reasoningEfforts.map((level) => ({
          effort: level.effort,
          ...(level.description ? { description: level.description } : {}),
        })),
        ...(m.defaultReasoningEffort ? { defaultReasoningEffort: m.defaultReasoningEffort } : {}),
      }))
    } catch {
      return curatedModels('chatgpt')
    }
  }

  app.get(API_ROUTES.setupStatus, async (c) => c.json<SetupStatus>(await status()))

  app.post(API_ROUTES.setupComplete, async (c) => {
    settings.set(ctx.db, SETUP_COMPLETE_KEY, '1')
    return c.json<SetupStatus>(await status())
  })

  // --- ChatGPT subscription ------------------------------------------------

  /** Errors meant for the chat stream self-mark; Setup shows the bare text. */
  const unmarked = (err: unknown): string => {
    const message = err instanceof Error ? err.message : String(err)
    return parseChatGptMarker(message)?.text ?? message
  }

  app.post(API_ROUTES.setupChatgptConnect, async (c) => {
    if (!deps.chatgpt) throw new HttpError(400, 'ChatGPT sign-in is not available', 'provider')
    try {
      const { authUrl } = await deps.chatgpt.connect()
      return c.json<{ ok: true; authUrl: string }>({ ok: true, authUrl })
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new HttpError(400, unmarked(err), 'provider')
    }
  })

  app.get(API_ROUTES.setupChatgptStatus, async (c) => {
    if (!deps.chatgpt) throw new HttpError(400, 'ChatGPT sign-in is not available', 'provider')
    const { connected, signingIn, email, plan, authExpired, connectError } =
      await deps.chatgpt.status()
    const body: ChatGptConnectStatus = {
      status: connected ? 'connected' : signingIn ? 'connecting' : 'idle',
      connected,
      ...(email ? { email } : {}),
      ...(plan ? { plan } : {}),
      ...(authExpired ? { authExpired: true } : {}),
      ...(connectError ? { connectError } : {}),
    }
    return c.json<ChatGptConnectStatus>(body)
  })

  app.delete(API_ROUTES.setupChatgptDisconnect, async (c) => {
    if (!deps.chatgpt) throw new HttpError(400, 'ChatGPT sign-in is not available', 'provider')
    await deps.chatgpt.disconnect()
    return c.json({ ok: true as const })
  })

  app.get(API_ROUTES.aiModels, async (c) => {
    const [subscription, custom] = await Promise.all([
      subscriptionModels(),
      Promise.resolve(
        listCustomProviders(ctx.db).flatMap((provider) =>
          provider.models.map(
            (model): ModelInfo => ({
              id: `${provider.id}:${model.id}`,
              provider: provider.id,
              modelId: model.id,
              // A display name from the endpoint's model list wins; otherwise
              // the provider name plus the raw id.
              label: model.label ?? `${provider.name} ${model.id}`,
              providerLabel: provider.name,
            }),
          ),
        ),
      ),
    ])
    return c.json<ModelInfo[]>([...subscription, ...custom])
  })

  app.post(API_ROUTES.setupCustomProviders, async (c) => {
    const request = parseOr400(addCustomProviderSchema, await readJson(c))
    const { saved } = saveCustomProvider(ctx.db, request)
    // Same id = intentional edit. A typed key stores/replaces; a blank one
    // keeps whatever is stored (an edit that only renames must not drop the
    // key — it is never shown again, so it could not be re-entered).
    if (request.apiKey) await secrets.set(providerKeyName(saved.id), request.apiKey)
    const customProviders = await Promise.all(listCustomProviders(ctx.db).map(decorate))
    return c.json<CustomProvidersResponse>({ customProviders })
  })

  // Raw segment (not the API_ROUTES helper): encodeURIComponent would escape the ':id' marker.
  app.delete(`${API_ROUTES.setupCustomProviders}/:id`, async (c) => {
    const id = c.req.param('id') ?? ''
    if (!deleteCustomProvider(ctx.db, id)) throw new HttpError(404, `No custom provider "${id}"`)
    await secrets.delete(providerKeyName(id))
    return c.json({ ok: true as const })
  })

  const fetchModelsSchema = z
    .object({
      id: z
        .string()
        .regex(/^custom-[a-z0-9][a-z0-9-]*$/)
        .optional(),
      baseUrl: z.string().trim().url().optional(),
      apiFormat: z.enum(['openai', 'anthropic']).optional(),
      apiKey: z.string().max(4096).optional(),
    })
    .refine((v) => Boolean(v.id || (v.baseUrl && v.apiFormat)), {
      message: 'need a provider id, or a base URL with an API format',
    })

  app.post(API_ROUTES.setupCustomModels, async (c) => {
    const body = parseOr400(fetchModelsSchema, await readJson(c))
    let baseUrl: string
    let apiFormat: 'openai' | 'anthropic'
    let apiKey = ''
    if (body.id) {
      const config = getCustomProvider(ctx.db, body.id)
      if (!config) throw new HttpError(404, `No custom provider "${body.id}"`)
      baseUrl = config.baseUrl
      apiFormat = config.apiFormat
      // A typed key wins; otherwise the stored one — never shown, but usable.
      apiKey = body.apiKey ?? (await secrets.get(providerKeyName(config.id))) ?? ''
    } else if (body.baseUrl && body.apiFormat) {
      baseUrl = body.baseUrl
      apiFormat = body.apiFormat
      apiKey = body.apiKey ?? ''
    } else {
      throw badRequest('need a provider id, or a base URL with an API format')
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/models`
    const headers: Record<string, string> =
      apiFormat === 'openai'
        ? apiKey
          ? { authorization: `Bearer ${apiKey}` }
          : {}
        : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    let res: Response
    try {
      res = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new HttpError(
        502,
        `Could not reach the model list at ${url} (${message}). Add models by hand.`,
        'provider',
      )
    }
    if (!res.ok) {
      res.body?.cancel()
      throw new HttpError(
        502,
        `The model list answered HTTP ${res.status}. The endpoint may not implement it — add models by hand.`,
        'provider',
      )
    }
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      throw new HttpError(
        502,
        'The model list response was not JSON. Add models by hand.',
        'provider',
      )
    }
    // OpenAI shape: { data: [{ id }] }. Anthropic: { data: [{ id, display_name }] }.
    // Some proxies use a bare array or { models: [...] } — accept all three.
    const list: unknown[] | null = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' &&
          parsed !== null &&
          Array.isArray((parsed as { data?: unknown }).data)
        ? (parsed as { data: unknown[] }).data
        : typeof parsed === 'object' &&
            parsed !== null &&
            Array.isArray((parsed as { models?: unknown }).models)
          ? (parsed as { models: unknown[] }).models
          : null
    if (!list) {
      throw new HttpError(
        502,
        'The model list response was not recognised. Add models by hand.',
        'provider',
      )
    }
    const seen = new Set<string>()
    const models: { id: string; label?: string }[] = []
    for (const entry of list) {
      const id =
        typeof entry === 'string'
          ? entry
          : typeof entry === 'object' &&
              entry !== null &&
              typeof (entry as { id?: unknown }).id === 'string'
            ? (entry as { id: string }).id
            : ''
      const label =
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { display_name?: unknown }).display_name === 'string'
          ? (entry as { display_name: string }).display_name
          : undefined
      if (!id || seen.has(id)) continue
      seen.add(id)
      models.push(label ? { id, label } : { id })
      if (models.length >= 64) break
    }
    if (models.length === 0) {
      throw new HttpError(502, 'The model list was empty. Add models by hand.', 'provider')
    }
    return c.json({ models })
  })
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
