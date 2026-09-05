import { z } from 'zod'
import { CodexError, redact } from './errors.js'
import type { CodexProtocol } from './protocol.js'

/**
 * The Codex backend's model catalog — `GET …/codex/models?client_version=…`
 * with the subscription headers. This is the ground truth for which models a
 * plan can use and which reasoning efforts each supports; the picker and the
 * reasoning-effort default both come from here instead of a static list.
 * Undocumented surface, like the rest of the backend: treat the shape
 * defensively and never let a catalog failure empty the picker.
 */

export interface CodexCatalogModel {
  slug: string
  displayName: string
  description?: string
  contextWindow?: number
  /** Cheapest first, as the backend orders them. */
  reasoningEfforts: { effort: string; description?: string }[]
  defaultReasoningEffort?: string
}

const CatalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string(),
      display_name: z.string(),
      description: z.string().nullish(),
      visibility: z.string().nullish(),
      context_window: z.number().nullish(),
      supported_reasoning_levels: z
        .array(
          z.object({
            effort: z.string(),
            description: z.string().nullish(),
          }),
        )
        .nullish(),
      default_reasoning_level: z.string().nullish(),
    }),
  ),
})

export function parseModelCatalog(body: unknown): CodexCatalogModel[] {
  const parsed = CatalogSchema.parse(body)
  const out: CodexCatalogModel[] = []
  for (const model of parsed.models) {
    // `visibility: "hide"` marks internal plumbing (observed: `gpt-reserve`,
    // `codex-auto-review`); only listed models are pickable.
    if (model.visibility === 'hide') continue
    out.push({
      slug: model.slug,
      displayName: model.display_name,
      ...(model.description ? { description: model.description } : {}),
      ...(model.context_window != null ? { contextWindow: model.context_window } : {}),
      reasoningEfforts: (model.supported_reasoning_levels ?? []).map((level) => ({
        effort: level.effort,
        ...(level.description ? { description: level.description } : {}),
      })),
      ...(model.default_reasoning_level
        ? { defaultReasoningEffort: model.default_reasoning_level }
        : {}),
    })
  }
  return out
}

export interface CatalogDeps {
  fetchImpl: typeof fetch
  protocol: CodexProtocol
  /** Fresh bearer + account id — `ChatGptConnection.getFreshAccessToken`. */
  getToken: () => Promise<{ accessToken: string; accountId?: string }>
  forceRefresh: () => Promise<{ accessToken: string; accountId?: string }>
}

/** Fetch the catalog, retrying once on 401 through a forced token refresh. */
export async function fetchModelCatalog(deps: CatalogDeps): Promise<CodexCatalogModel[]> {
  const base = deps.protocol.responsesUrl.replace(/\/responses\/?$/, '')
  const url = `${base}/models?client_version=${encodeURIComponent(deps.protocol.clientVersion)}`

  const issue = async (forceRefresh: boolean): Promise<Response> => {
    const token = forceRefresh ? await deps.forceRefresh() : await deps.getToken()
    let res: Response
    try {
      res = await deps.fetchImpl(url, {
        headers: {
          authorization: `Bearer ${token.accessToken}`,
          ...(token.accountId ? { 'chatgpt-account-id': token.accountId } : {}),
          'openai-beta': 'responses=experimental',
          originator: 'codex_cli_rs',
          'user-agent': `codex_cli_rs/${deps.protocol.clientVersion}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      throw new CodexError('transport', redact(err instanceof Error ? err.message : String(err)))
    }
    return res
  }

  let res = await issue(false)
  if (res.status === 401) {
    res = await issue(true)
    if (res.status === 401) {
      throw new CodexError('auth_expired', 'the catalog request was rejected after a token refresh')
    }
  }
  if (res.status === 429) throw new CodexError('quota')
  if (!res.ok) {
    let text = ''
    try {
      text = redact(await res.text()).slice(0, 256)
    } catch {
      // no body
    }
    throw new CodexError(
      res.status >= 500 ? 'transport' : 'endpoint_changed',
      `HTTP ${res.status}${text ? `: ${text}` : ''}`,
    )
  }
  const body: unknown = await res.json().catch(() => undefined)
  if (body === undefined)
    throw new CodexError('transport', 'the catalog endpoint returned a non-JSON body')
  try {
    return parseModelCatalog(body)
  } catch (err) {
    // The backend changed its shape: say so instead of losing the detail.
    throw new CodexError(
      'endpoint_changed',
      `unexpected catalog shape (${err instanceof Error ? err.message.slice(0, 160) : String(err)})`,
    )
  }
}
