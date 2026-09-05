import { z } from 'zod'
import type { ModelInfo, ProviderId } from '../shared/api.js'

/**
 * Model providers: key validation and the model picker's list. Both use the
 * providers' models-list endpoints — the cheapest authenticated call there
 * is (no tokens consumed) and both answer 401 for a bad key.
 */

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
}

interface ProviderEndpoint {
  /** Cheapest authenticated GET, used to validate a key. */
  validateUrl: string
  /** Full models list, used to learn which models the key can use. */
  listUrl: string
  headers(apiKey: string): Record<string, string>
}

const ENDPOINTS: Record<ProviderId, ProviderEndpoint> = {
  openai: {
    validateUrl: 'https://api.openai.com/v1/models',
    listUrl: 'https://api.openai.com/v1/models',
    headers: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
  },
  anthropic: {
    validateUrl: 'https://api.anthropic.com/v1/models?limit=1',
    // The list is paginated (default 20, max 1000); one page covers every model.
    listUrl: 'https://api.anthropic.com/v1/models?limit=1000',
    headers: (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
  },
}

/**
 * Models we offer in the picker, per provider. Deliberately short: sensible
 * defaults for reading a PR, not a catalogue. `listModels` narrows it further
 * to what the user's key can actually reach.
 */
const CURATED: Record<ProviderId, readonly { modelId: string; label: string }[]> = {
  openai: [
    { modelId: 'gpt-5', label: 'GPT-5' },
    { modelId: 'gpt-5-mini', label: 'GPT-5 mini' },
    { modelId: 'gpt-5-nano', label: 'GPT-5 nano' },
    { modelId: 'gpt-4.1', label: 'GPT-4.1' },
    { modelId: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  ],
  anthropic: [
    { modelId: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { modelId: 'claude-opus-4-1', label: 'Claude Opus 4.1' },
    { modelId: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
}

export function curatedModels(provider: ProviderId): ModelInfo[] {
  return CURATED[provider].map(({ modelId, label }) => ({
    id: `${provider}:${modelId}`,
    provider,
    modelId,
    label,
  }))
}

export type KeyValidation = { ok: true } | { ok: false; error: string }

export interface ProviderRequestOptions {
  /** Abort the request after this long. Default 10 s. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Check that `apiKey` is accepted by `provider`. Never throws: every failure
 * comes back as `{ ok: false, error }` with a message fit for the Setup screen.
 * The key is sent to the provider and nowhere else; it never appears in `error`.
 */
export async function validateApiKey(
  provider: ProviderId,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  opts: ProviderRequestOptions = {},
): Promise<KeyValidation> {
  const label = PROVIDER_LABELS[provider]
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let res: Response
  try {
    res = await requestModels(
      provider,
      apiKey,
      ENDPOINTS[provider].validateUrl,
      fetchImpl,
      timeoutMs,
    )
  } catch (err) {
    return { ok: false, error: `Could not reach ${label}: ${describeNetworkError(err, timeoutMs)}` }
  }
  discardBody(res)
  if (res.ok) return { ok: true }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: `That key was rejected by ${label}.` }
  }
  const statusText = res.statusText ? ` ${res.statusText}` : ''
  return {
    ok: false,
    error: `${label} returned HTTP ${res.status}${statusText} while checking the key.`,
  }
}

const ModelsListBody = z.object({ data: z.array(z.object({ id: z.string() })) })

/**
 * The curated models for `provider` that the key can actually use, in curated
 * order. Falls back to the whole curated list when the models endpoint cannot
 * be reached or answers something unexpected, so a flaky network never empties
 * the picker.
 */
export async function listModels(
  provider: ProviderId,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  opts: ProviderRequestOptions = {},
): Promise<ModelInfo[]> {
  const curated = curatedModels(provider)
  let available: string[]
  try {
    const res = await requestModels(
      provider,
      apiKey,
      ENDPOINTS[provider].listUrl,
      fetchImpl,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    if (!res.ok) {
      discardBody(res)
      return curated
    }
    available = ModelsListBody.parse(await res.json()).data.map((m) => m.id)
  } catch {
    return curated
  }
  return curated.filter((m) => available.some((id) => matchesCuratedModel(m.modelId, id)))
}

/**
 * Anthropic's list holds dated snapshots only (`claude-sonnet-4-5-20250929`),
 * while the alias (`claude-sonnet-4-5`) is what the API accepts and what we
 * offer; OpenAI lists both aliases and `-YYYY-MM-DD` snapshots. So an id
 * counts as available when it is the alias itself or a dated snapshot of it.
 */
export function matchesCuratedModel(curatedId: string, availableId: string): boolean {
  if (availableId === curatedId) return true
  if (!availableId.startsWith(`${curatedId}-`)) return false
  return SNAPSHOT_SUFFIX.test(availableId.slice(curatedId.length))
}

const SNAPSHOT_SUFFIX = /^-(?:\d{8}|\d{4}-\d{2}-\d{2})$/

function requestModels(
  provider: ProviderId,
  apiKey: string,
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'GET',
    headers: { accept: 'application/json', ...ENDPOINTS[provider].headers(apiKey) },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/** Free the connection when we only needed the status line. */
function discardBody(res: Response): void {
  res.body?.cancel().catch(() => undefined)
}

function describeNetworkError(err: unknown, timeoutMs: number): string {
  if (!(err instanceof Error)) return String(err)
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return `no response within ${Math.round(timeoutMs / 1000)} s`
  }
  // Node's fetch says only "fetch failed"; the useful part (ENOTFOUND, ECONNREFUSED, …) is the cause.
  const cause = (err as { cause?: unknown }).cause
  const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  return detail && detail !== err.message ? `${err.message} (${detail})` : err.message
}
