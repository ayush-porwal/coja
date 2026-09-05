import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { CodexError, redact } from './errors.js'
import { newSessionId } from './oauth.js'
import { CODEX_PROTOCOL, type CodexProtocol, UNSUPPORTED_BODY_PARAMETERS } from './protocol.js'

/**
 * The ChatGPT-subscription language model: the stock `@ai-sdk/openai`
 * Responses provider pointed at the Codex backend through a wrapped `fetch`
 * that owns the subscription-specific bits (docs/research/…, §1.4). The agent
 * loop, the six tools and the chat handler see an ordinary `LanguageModel`
 * and cannot tell which billing path is active.
 *
 * The wrapper: forces the three fixed body fields (`stream`, `store`,
 * `parallel_tool_calls`), deletes the parameters the backend rejects with
 * `400 Unsupported parameter` (the harness always sets `maxOutputTokens`,
 * which is in that list), requests encrypted reasoning content so `store:false`
 * tool loops stay coherent, appends the required `client_version`, injects the
 * subscription headers, retries exactly once on 401 through a forced refresh,
 * and maps 429 / auth death / other non-2xx to typed errors whose messages
 * are fit for the chat panel (marked, token-free).
 */

/** Where the transport gets its bearer — `ChatGptConnection` implements this. */
export interface CodexTokenSource {
  getFreshAccessToken(): Promise<{ accessToken: string; accountId?: string }>
  forceRefresh(): Promise<{ accessToken: string; accountId?: string }>
}

export interface CodexModelDeps {
  tokens: CodexTokenSource
  /** Bare model id (`gpt-5.4`), not a wire id. */
  modelId: string
  /** User-chosen reasoning effort (validated against the catalog upstream). */
  reasoningEffort?: string
  /** The catalog's default effort for this model, used when the request carries none. */
  defaultReasoningEffort?: string
  /** Test seam; production uses global fetch. */
  fetchImpl?: typeof fetch
  protocol?: CodexProtocol
}

export function createCodexLanguageModel(deps: CodexModelDeps): LanguageModel {
  const protocol = deps.protocol ?? CODEX_PROTOCOL
  const fetchImpl = deps.fetchImpl ?? fetch
  const sessionId = newSessionId()
  // createOpenAI appends `/responses` to the base URL.
  const baseURL = protocol.responsesUrl.replace(/\/responses\/?$/, '')

  const request = async (
    input: string | URL | globalThis.Request,
    init: RequestInit | undefined,
  ): Promise<Response> => {
    const rawBody = typeof init?.body === 'string' ? init.body : undefined
    const parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined
    const streaming = parsedBody?.stream === true

    const url = new URL(typeof input === 'string' ? input : input.toString())
    url.searchParams.set('client_version', protocol.clientVersion)

    const issue = async (forceRefresh: boolean): Promise<Response> => {
      const token = forceRefresh
        ? await deps.tokens.forceRefresh()
        : await deps.tokens.getFreshAccessToken()
      const effort = deps.reasoningEffort ?? deps.defaultReasoningEffort
      try {
        return await fetchImpl(url, {
          ...init,
          ...(parsedBody ? { body: JSON.stringify(subscriptionBody(parsedBody, effort)) } : {}),
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            authorization: `Bearer ${token.accessToken}`,
            ...(token.accountId ? { 'chatgpt-account-id': token.accountId } : {}),
            'openai-beta': 'responses=experimental',
            originator: 'codex_cli_rs',
            session_id: sessionId,
          },
        })
      } catch (err) {
        // DNS/TLS/reset and our own aborts surface as a typed, redacted error
        // instead of a raw TypeError no one can classify.
        throw new CodexError('transport', redact(err instanceof Error ? err.message : String(err)))
      }
    }

    let response = await issue(false)
    if (response.status === 401) {
      response = await issue(true)
      if (response.status === 401) {
        throw new CodexError('auth_expired', 'the request was rejected after a token refresh')
      }
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'))
      throw new CodexError('quota', undefined, {
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1000 }
          : {}),
      })
    }
    if (!response.ok) {
      throw new CodexError(
        endpointErrorCode(response.status),
        await bodySnippet(response, protocol),
      )
    }
    if (parsedBody && !streaming) return collapseStreamedResponse(response)
    return response
  }

  const openai = createOpenAI({
    // Unused: the wrapper replaces the Authorization header on every request.
    apiKey: 'coja-chatgpt-subscription',
    baseURL,
    fetch: request as typeof fetch,
  })
  return openai.responses(deps.modelId)
}

/**
 * Rewrite the SDK's request body into what the subscription backend accepts.
 * The backend rejects the whole request when any of the unsupported
 * parameters is present and names only the first offender, so the list is
 * enforced here rather than at every call site.
 */
export function subscriptionBody(
  body: Record<string, unknown>,
  reasoningEffort?: string,
): Record<string, unknown> {
  const rewritten: Record<string, unknown> = { ...body }
  for (const parameter of UNSUPPORTED_BODY_PARAMETERS) delete rewritten[parameter]
  rewritten.stream = true
  rewritten.store = false
  rewritten.parallel_tool_calls = false
  if (Array.isArray(rewritten.input)) {
    rewritten.input = stripServerSideState(rewritten.input)
  }
  // The catalog publishes per-model reasoning efforts (including levels the
  // AI SDK's own provider-option schema does not know, e.g. `ultra`), so the
  // effort is injected here rather than through provider options. An explicit
  // `reasoning` on the request always wins.
  if (reasoningEffort && rewritten.reasoning === undefined) {
    rewritten.reasoning = { effort: reasoningEffort }
  }
  // `store:false` turns: reasoning items must come back encrypted, or a tool
  // call can lose its required preceding reasoning item.
  const include = Array.isArray(rewritten.include) ? [...(rewritten.include as unknown[])] : []
  if (!include.includes('reasoning.encrypted_content')) include.push('reasoning.encrypted_content')
  rewritten.include = include
  return rewritten
}

/**
 * With `store:false` the backend persists nothing, so input items that carry
 * server-side ids from a previous response (`msg_…`, `fc_…`, `rs_…`) reference
 * records that do not exist and the whole request is refused
 * (`Item with id '…' not found`). `call_id` stays: it is the local key pairing
 * a `function_call` with its `function_call_output`. `item_reference` entries
 * only ever point at stored state, so they are dropped outright.
 */
export function stripServerSideState(items: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      out.push(item)
      continue
    }
    const record = item as Record<string, unknown>
    if (record.type === 'item_reference') continue
    const clone = { ...record }
    delete clone.id
    out.push(clone)
  }
  return out
}

/**
 * `doGenerate` issued a non-streaming request; the backend only speaks
 * streaming, so the SSE has to collapse into one JSON response. This
 * backend's `response.completed` carries `output: []` — the turn's items only
 * ever arrive via `response.output_item.done`, so a completed payload with an
 * empty output gets the collected items restored.
 */
async function collapseStreamedResponse(response: Response): Promise<Response> {
  if (!response.body) throw new CodexError('transport', 'the backend returned no response stream')
  const events = parseSse(await response.text())
  let completed: Record<string, unknown> | undefined
  let failure: Record<string, unknown> | undefined
  const items: unknown[] = []
  for (const event of events) {
    if (event.name === 'response.completed') completed = event.data
    else if (event.name === 'response.failed' || event.name === 'error') failure = event.data
    else if (event.name === 'response.output_item.done') {
      const item = (event.data as { item?: unknown } | undefined)?.item
      if (item !== undefined) items.push(item)
    }
  }
  if (!completed) {
    const detail = failure ? `: ${JSON.stringify(failure).slice(0, 512)}` : ''
    throw new CodexError('transport', `the response stream ended without completing${detail}`)
  }
  const payload = (completed.response ?? completed) as Record<string, unknown>
  const restored =
    Array.isArray(payload.output) && payload.output.length > 0
      ? payload
      : { ...payload, output: items }
  return new Response(JSON.stringify(restored), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

interface SseEvent {
  name: string
  data: Record<string, unknown> | undefined
}

/** Minimal SSE reader for the collapse path (enough for this backend's frames). */
export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = []
  for (const block of text.split(/\r?\n\r?\n|\r\n\r\n/)) {
    let name = 'message'
    const dataLines: string[] = []
    for (const line of block.split(/\r?\n|\r\n/)) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    const data = dataLines.join('\n')
    if (data === '' || data === '[DONE]') continue
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      events.push({
        name: typeof parsed.type === 'string' ? parsed.type : name,
        data: parsed,
      })
    } catch {
      events.push({ name, data: undefined })
    }
  }
  return events
}

/** 4xx on this backend almost always means the request shape drifted or a plan gate. */
function endpointErrorCode(status: number): 'endpoint_changed' | 'transport' {
  return status >= 500 ? 'transport' : 'endpoint_changed'
}

async function bodySnippet(response: Response, _protocol: CodexProtocol): Promise<string> {
  let text = ''
  try {
    text = await response.text()
  } catch {
    return `HTTP ${response.status}`
  }
  // Redact first, truncate second: a token spanning the cut must not leak.
  return `HTTP ${response.status}${text ? `: ${redact(text).slice(0, 512)}` : ''}`
}
