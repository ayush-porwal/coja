import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { createCodexLanguageModel } from '../codex/provider.js'
import { badRequest, HttpError } from '../routes/http.js'
import { curatedModels, PROVIDER_LABELS } from '../secrets/providers.js'
import { providerKeyName, type SecretStore } from '../secrets/store.js'
import type { CustomProviderConfig } from '../shared/api.js'

/** Looks up a custom provider config by id; built in services from the db. */
export type CustomProviderSource = (id: string) => CustomProviderConfig | undefined

const CUSTOM_PROVIDER_SHAPE = /^custom-[a-z0-9][a-z0-9-]*$/

/**
 * Model ids on the wire are `<provider>:<model id>` (`ModelInfo.id`). This
 * module turns one into a Vercel AI SDK language model, reading keys from the
 * secret store at call time so a key saved in Setup is used by the very next
 * turn. Keys never leave this process except in the provider call.
 *
 * Two provider kinds: `chatgpt` — the "Sign in with ChatGPT" subscription,
 * whose tokens flow through `createCodexLanguageModel` — and custom
 * endpoints (`custom-<slug>`), user-added in Setup and speaking the OpenAI
 * chat-completions or Anthropic messages protocol at their own base URL. The
 * rest of the AI layer only ever sees the structural
 * `SubscriptionProvider`/`LanguageModel` shapes — not which billing path is
 * active.
 */

/** What a connected subscription must offer: status facts, fresh tokens, model catalog. */
export interface SubscriptionProvider {
  status(): Promise<{ connected: boolean }>
  getFreshAccessToken(): Promise<{ accessToken: string; accountId?: string }>
  forceRefresh(): Promise<{ accessToken: string; accountId?: string }>
  /** The catalog's default reasoning effort for a model, from cache (best effort). */
  defaultReasoningEffortFor(modelId: string): string | undefined
  /** Whether the backend catalog offers `effort` for `modelId`. */
  supportsReasoningEffort(modelId: string, effort: string): Promise<boolean>
}

/**
 * Split and check a wire model id. The model id is forwarded to the provider,
 * so an arbitrary string is not something to relay: `chatgpt` accepts
 * slug-shaped ids (the backend catalog vouches for them) and custom ids are
 * shape-checked here and vouched for existence by the lookup.
 */
export function parseModelId(
  id: string,
  custom?: CustomProviderSource,
): { provider: string; modelId: string } {
  const colon = id.indexOf(':')
  if (colon <= 0 || colon === id.length - 1) {
    throw badRequest(`invalid model id "${id}": expected <provider>:<model id>`)
  }
  const provider = id.slice(0, colon)
  const modelId = id.slice(colon + 1)
  if (provider === 'chatgpt') {
    // The subscription picker is driven by the backend's catalog, so the exact
    // set cannot be curated here; accept slug-shaped ids and let the backend
    // reject unknown models with its own (honest) error.
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(modelId)) {
      throw badRequest(`invalid ${PROVIDER_LABELS.chatgpt} model id "${id}"`)
    }
    return { provider, modelId }
  }
  if (CUSTOM_PROVIDER_SHAPE.test(provider)) {
    if (custom && !custom(provider)) {
      throw badRequest(`unknown model provider "${provider}" (not in Setup's model providers)`)
    }
    if (!/^[a-z0-9][a-z0-9._\-/]*$/i.test(modelId)) {
      throw badRequest(`invalid model id "${id}"`)
    }
    return { provider, modelId }
  }
  throw badRequest(
    `unknown model provider "${provider}" (expected ${PROVIDER_LABELS.chatgpt} or a model provider from Setup)`,
  )
}

export async function resolveLanguageModel(
  id: string,
  secrets: SecretStore,
  subscription?: SubscriptionProvider,
  reasoningEffort?: string,
  customProviders?: CustomProviderSource,
): Promise<LanguageModel> {
  const { provider, modelId } = parseModelId(id, customProviders)
  if (provider === 'chatgpt') {
    if (!subscription || !(await subscription.status()).connected) {
      throw new HttpError(
        400,
        'ChatGPT is not connected. Connect it in Setup, or pick another model.',
        'provider',
      )
    }
    return createCodexLanguageModel({
      tokens: subscription,
      modelId,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(subscription.defaultReasoningEffortFor(modelId)
        ? { defaultReasoningEffort: subscription.defaultReasoningEffortFor(modelId) }
        : {}),
    })
  }
  const config = customProviders?.(provider)
  if (!config) {
    throw new HttpError(400, `Unknown model provider "${provider}".`, 'provider')
  }
  // Local endpoints (Ollama, LM Studio) often run keyless: a placeholder
  // keeps the SDKs happy and the endpoint ignores it.
  const apiKey = (await secrets.get(providerKeyName(provider))) || 'missing-key'
  // `openai(modelId)` defaults to the Responses API (`{base}/responses`), but
  // "apiFormat: openai" promises chat-completions — every OpenAI-compatible
  // endpoint (z.ai, OpenRouter, Ollama…) serves `{base}/chat/completions`.
  // The default silently 404s on them, so chat() is explicit here.
  return config.apiFormat === 'openai'
    ? createOpenAI({ baseURL: config.baseUrl, apiKey }).chat(modelId)
    : createAnthropic({ baseURL: config.baseUrl, apiKey })(modelId)
}

/**
 * The subscription's first bootstrap model when ChatGPT is connected, else
 * null. Custom endpoints never default: the picker sends an explicit model
 * with every turn, so a default would only be read when nothing usable exists.
 */
export async function defaultModelId(subscription?: SubscriptionProvider): Promise<string | null> {
  if (subscription && (await subscription.status()).connected) {
    return curatedModels('chatgpt')[0]?.id ?? null
  }
  return null
}
